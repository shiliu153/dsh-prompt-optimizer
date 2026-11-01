// Host-side sources are ES modules: `require` does not exist in them, and no
// Harness package is imported.
//
// WHY THIS TEST EXISTS: the Host half runs inside the DSH process, where a
// stray `require(...)` only fails on the branch that takes it — so the unit
// tests, which run under plain node, can pass while the real route throws
// "require is not defined". The second rule pins the other design decision:
// this bundle depends on nothing but node builtins and its own files, so it
// installs from a plain checkout without resolving `@deepseek-ai/*`.
//
// Scope: index.js and lib/**/*.js. client.js is excluded because its `require`
// is the browser module loader's own parameter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Every Host-side source file, relative to the package root. */
function hostSources() {
  const files = ['index.js'];
  for (const name of fs.readdirSync(path.join(root, 'lib'))) {
    if (name.endsWith('.js')) files.push(path.join('lib', name));
  }
  return files;
}

test('host sources contain no CommonJS require()', () => {
  const offenders = [];
  for (const rel of hostSources()) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    text.split('\n').forEach((line, index) => {
      if (/\brequire\s*\(/.test(line)) offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `host sources must not call require():\n${offenders.join('\n')}`);
});

test('host sources import only node builtins and relative files', () => {
  const offenders = [];
  for (const rel of hostSources()) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('node:') || specifier.startsWith('./') || specifier.startsWith('../')) continue;
      offenders.push(`${rel}: ${specifier}`);
    }
  }
  assert.deepEqual(offenders, [], `host sources must not import packages:\n${offenders.join('\n')}`);
});
