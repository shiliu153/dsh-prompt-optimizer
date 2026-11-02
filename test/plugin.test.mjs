import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_SYSTEM_PROMPT, MAX_INPUT_CHARS, MAX_PROMPT_CHARS } from '../lib/defaults.js';
import { normalizePrompt, readSettings, resetSettings, writeSettings } from '../lib/settings.js';
import { optimizeDraft, pickEffort, requestMessages, validateRequest } from '../lib/optimize.js';
import { createRoutes, ROUTE_PREFIX, settingsPayload } from '../lib/routes.js';

/** One temporary directory per test file. */
function tempFile(name = 'settings.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-po-'));
  return { dir, file: path.join(dir, name) };
}

/** A stub LLM service that yields the given chunks and records its options. */
function stubLlm(chunks, { prepareError, info } = {}) {
  const seen = { prepare: [], options: [] };
  return {
    seen,
    async prepareCall(config, _signal, configure) {
      if (prepareError) throw prepareError;
      seen.prepare.push(config);
      const controls = configure === undefined ? config : configure({ ...config }, info ?? {});
      return {
        config: { ...controls },
        stream(options) {
          seen.options.push(options);
          return (async function* run() {
            for (const chunk of chunks) yield chunk;
          })();
        },
      };
    },
  };
}

const OK_CHUNKS = [
  { type: 'text-delta', index: 0, text: '  Optimized' },
  { type: 'text-delta', index: 0, text: ' prompt.  ' },
  { type: 'finish', reason: { kind: 'stop' } },
];

// ---- request validation ----

test('validateRequest rejects an empty draft', () => {
  const result = validateRequest({ provider: 'p', model: 'm', text: '   ' });
  assert.equal(result.error.code, 'empty_input');
  assert.equal(result.error.status, 400);
});

test('validateRequest rejects an oversized draft', () => {
  const result = validateRequest({ provider: 'p', model: 'm', text: 'x'.repeat(MAX_INPUT_CHARS + 1) });
  assert.equal(result.error.code, 'too_long');
  assert.equal(result.error.status, 413);
});

test('validateRequest requires a provider and model', () => {
  assert.equal(validateRequest({ model: 'm', text: 'hi' }).error.code, 'no_model');
  assert.equal(validateRequest({ provider: 'p', text: 'hi' }).error.code, 'no_model');
});

test('validateRequest normalizes a usable body', () => {
  const result = validateRequest({ provider: ' p ', model: ' m ', text: 'hi' });
  assert.deepEqual(result.value, { provider: 'p', model: 'm', text: 'hi' });
});

test('requestMessages builds one request-only user input', () => {
  assert.deepEqual(requestMessages('hi'), [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
});

test('pickEffort takes the least advertised effort', () => {
  assert.equal(pickEffort({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }), 'low');
  assert.equal(pickEffort({}), undefined);
  assert.equal(pickEffort({ reasoning: { efforts: [] } }), undefined);
});

// ---- rewrite ----

test('optimizeDraft returns the trimmed model text', async () => {
  const llm = stubLlm(OK_CHUNKS, { info: { reasoning: { efforts: [{ id: 'low' }] } } });
  const result = await optimizeDraft({
    llm,
    settings: { systemPrompt: 'INSTRUCTION' },
    body: { provider: 'p', model: 'm', text: 'draft' },
  });
  assert.deepEqual(result.value, { text: 'Optimized prompt.' });
  assert.equal(llm.seen.options[0].system, 'INSTRUCTION');
  assert.equal(llm.seen.options[0].reasoningEffort, 'low');
  assert.equal(llm.seen.options[0].maxTokens, 4096);
});

test('optimizeDraft reports an empty answer instead of replacing the draft', async () => {
  const llm = stubLlm([
    { type: 'text-delta', index: 0, text: '   ' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const result = await optimizeDraft({
    llm,
    settings: { systemPrompt: 'x' },
    body: { provider: 'p', model: 'm', text: 'draft' },
  });
  assert.equal(result.error.code, 'empty_response');
  assert.equal(result.error.status, 502);
});

test('optimizeDraft forwards a terminal failure code', async () => {
  const llm = stubLlm([
    { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow down' } } },
  ]);
  const result = await optimizeDraft({
    llm,
    settings: { systemPrompt: 'x' },
    body: { provider: 'p', model: 'm', text: 'draft' },
  });
  assert.deepEqual(result.error, { code: 'RATE_LIMIT', message: 'slow down', status: 502 });
});

test('optimizeDraft maps a missing adapter to 400', async () => {
  const error = Object.assign(new Error('no adapter registered for provider "nope"'), { code: 'NO_ADAPTER' });
  const llm = stubLlm([], { prepareError: error });
  const result = await optimizeDraft({
    llm,
    settings: { systemPrompt: 'x' },
    body: { provider: 'nope', model: 'm', text: 'draft' },
  });
  assert.equal(result.error.code, 'NO_ADAPTER');
  assert.equal(result.error.status, 400);
});

test('optimizeDraft validates before touching the model', async () => {
  const llm = stubLlm(OK_CHUNKS);
  const result = await optimizeDraft({ llm, settings: { systemPrompt: 'x' }, body: { text: '' } });
  assert.equal(result.error.code, 'empty_input');
  assert.equal(llm.seen.prepare.length, 0);
});

// ---- settings ----

test('readSettings falls back to the built-in instruction', () => {
  const { file } = tempFile();
  const settings = readSettings(file);
  assert.equal(settings.systemPrompt, DEFAULT_SYSTEM_PROMPT);
  assert.equal(settings.custom, false);
});

test('writeSettings round-trips and reset restores the default', () => {
  const { file } = tempFile();
  assert.equal(writeSettings('  custom instruction  ', file).ok, true);
  const stored = readSettings(file);
  assert.equal(stored.systemPrompt, 'custom instruction');
  assert.equal(stored.custom, true);
  resetSettings(file);
  assert.equal(readSettings(file).systemPrompt, DEFAULT_SYSTEM_PROMPT);
});

test('writeSettings refuses an empty or oversized instruction', () => {
  const { file } = tempFile();
  assert.equal(writeSettings('   ', file).ok, false);
  assert.equal(writeSettings('x'.repeat(MAX_PROMPT_CHARS + 1), file).ok, false);
});

test('readSettings ignores a corrupt file', () => {
  const { file } = tempFile();
  fs.writeFileSync(file, '{ not json', 'utf8');
  assert.equal(readSettings(file).systemPrompt, DEFAULT_SYSTEM_PROMPT);
});

test('normalizePrompt trims and bounds', () => {
  assert.equal(normalizePrompt(' a '), 'a');
  assert.equal(normalizePrompt(''), undefined);
  assert.equal(normalizePrompt(42), undefined);
});

// ---- routes ----

test('settings routes read, save, and reset the instruction', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-po-home-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const routes = createRoutes({ llm: stubLlm(OK_CHUNKS) });
    const byPath = new Map(routes.map((route) => [`${route.methods[0]} ${route.path}`, route]));
    assert.deepEqual(
      routes.map((route) => route.path),
      [
        `${ROUTE_PREFIX}/optimize`,
        `${ROUTE_PREFIX}/settings`,
        `${ROUTE_PREFIX}/settings/save`,
        `${ROUTE_PREFIX}/settings/reset`,
      ],
    );

    const initial = await byPath.get(`GET ${ROUTE_PREFIX}/settings`).fetch(new Request('http://x/'));
    assert.equal(initial.status, 200);
    assert.equal((await initial.json()).systemPrompt, DEFAULT_SYSTEM_PROMPT);

    const save = await byPath
      .get(`POST ${ROUTE_PREFIX}/settings/save`)
      .fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify({ systemPrompt: 'mine' }) }));
    assert.equal(save.status, 200);
    assert.equal((await save.json()).custom, true);
    assert.equal(settingsPayload().systemPrompt, 'mine');

    const invalid = await byPath
      .get(`POST ${ROUTE_PREFIX}/settings/save`)
      .fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify({ systemPrompt: '  ' }) }));
    assert.equal(invalid.status, 400);

    const reset = await byPath.get(`POST ${ROUTE_PREFIX}/settings/reset`).fetch(new Request('http://x/', { method: 'POST' }));
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).systemPrompt, DEFAULT_SYSTEM_PROMPT);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the optimize route answers a rewrite and a coded failure', async () => {
  const routes = createRoutes({ llm: stubLlm(OK_CHUNKS) });
  const optimize = routes.find((route) => route.path.endsWith('/optimize'));
  const ok = await optimize.fetch(
    new Request('http://x/', {
      method: 'POST',
      body: JSON.stringify({ provider: 'p', model: 'm', text: 'draft' }),
    }),
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { text: 'Optimized prompt.' });

  const bad = await optimize.fetch(new Request('http://x/', { method: 'POST', body: 'not json' }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'bad_request');
});

// ---- client bundle ----

/**
 * Load client.js against a stub module table and return the module it registers.
 *
 * The bundle is a classic script, so it is evaluated with a stand-in `window`
 * instead of being imported; `react` is the only module it asks for.
 */
function loadClient() {
  const loaded = [];
  globalThis.window = {
    __ModuleLoader__: {
      load(registration) {
        loaded.push(registration);
      },
    },
  };
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  new Function('window', source)(globalThis.window);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, '@dsh-contrib/dsh-prompt-optimizer');
  const reactStub = { createElement: () => null };
  return loaded[0].factory((name) => {
    if (name === 'react') return reactStub;
    throw new Error(`unexpected require: ${name}`);
  });
}

test('the client bundle exposes its pure helpers', () => {
  const mod = loadClient();
  const { isModelReady, buildRequest, errorText, ZH, EN } = mod.__test;
  assert.equal(isModelReady({ provider: 'p', model: 'm' }), true);
  assert.equal(isModelReady({ provider: '', model: 'm' }), false);
  assert.equal(isModelReady(undefined), false);
  assert.deepEqual(buildRequest('hi', { provider: 'p', model: 'm', reasoningEffort: 'low' }), {
    provider: 'p',
    model: 'm',
    text: 'hi',
  });
  assert.equal(errorText(502, { error: { message: 'boom' } }), 'boom');
  assert.equal(errorText(500, null), 'HTTP 500');
  assert.deepEqual(mod.inject, ['slots', 'locale']);
  assert.equal(typeof mod.apply, 'function');
  // Every key the button can raise must exist in both dictionaries, or a
  // localized build would surface the raw key instead of a sentence.
  for (const dictionary of [ZH, EN]) {
    for (const key of ['action', 'cancel', 'emptyDraft', 'noModel', 'emptyResponse']) {
      assert.equal(typeof dictionary[key], 'string', `missing dictionary key: ${key}`);
      assert.notEqual(dictionary[key], '', `empty dictionary value: ${key}`);
    }
  }
});

// ---- manifest ----

test('the manifest declares the bundle, the client half, and its exports', () => {
  const root = new URL('..', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.name, '@dsh-contrib/dsh-prompt-optimizer');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.ok(manifest.files.includes('client.js'));
  assert.ok(manifest.files.includes('lib/'));
  const patch = fs.readFileSync(new URL('cordis.patch.yml', root), 'utf8');
  assert.match(patch, /id: dsh-prompt-optimizer/);
  assert.match(patch, /@dsh-contrib\/dsh-prompt-optimizer/);
  for (const locale of ['zh', 'en']) {
    const json = JSON.parse(fs.readFileSync(new URL(`locale/${locale}.json`, root), 'utf8'));
    assert.equal(typeof json.meta.title, 'string');
    assert.equal(typeof json.meta.description, 'string');
  }
});
