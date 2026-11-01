/** Exact Fetch routes for the composer button and the settings page. */
import { DEFAULT_SYSTEM_PROMPT, MAX_PROMPT_CHARS } from './defaults.js';
import { optimizeDraft } from './optimize.js';
import { readSettings, resetSettings, writeSettings } from './settings.js';

export const ROUTE_PREFIX = '/api/dsh-prompt-optimizer';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function fail(error) {
  return json({ error: { code: error.code, message: error.message } }, error.status ?? 500);
}

/** Read a JSON body; an empty body is an empty object. */
async function readJson(req) {
  let text;
  try {
    text = await req.text();
  } catch (error) {
    return { error: { code: 'bad_request', message: `unreadable body: ${error.message}`, status: 400 } };
  }
  if (text.trim() === '') return { value: {} };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: { code: 'bad_request', message: 'body must be JSON', status: 400 } };
  }
}

/** The settings page's whole view of the instruction. */
export function settingsPayload() {
  const settings = readSettings();
  return {
    systemPrompt: settings.systemPrompt,
    custom: settings.custom,
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
    maxChars: MAX_PROMPT_CHARS,
    file: settings.file,
  };
}

/**
 * Build the route table.
 * @param options.llm - the harness LLM service used for the rewrite.
 * @returns routes shaped for `ctx.connection.registerFetchRoute`.
 */
export function createRoutes({ llm }) {
  return [
    {
      path: `${ROUTE_PREFIX}/optimize`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (req) => {
        const body = await readJson(req);
        if (body.error) return fail(body.error);
        const settings = readSettings();
        const result = await optimizeDraft({ llm, settings, body: body.value, signal: req.signal });
        return result.error ? fail(result.error) : json(result.value);
      },
    },
    {
      path: `${ROUTE_PREFIX}/settings`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => json(settingsPayload()),
    },
    {
      path: `${ROUTE_PREFIX}/settings/save`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (req) => {
        const body = await readJson(req);
        if (body.error) return fail(body.error);
        const written = writeSettings(body.value?.systemPrompt);
        if (!written.ok) {
          return fail({
            code: 'invalid_prompt',
            message: `the instruction must be 1-${MAX_PROMPT_CHARS} characters`,
            status: 400,
          });
        }
        return json(settingsPayload());
      },
    },
    {
      path: `${ROUTE_PREFIX}/settings/reset`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: () => {
        resetSettings();
        return json(settingsPayload());
      },
    },
  ];
}
