/** Durable rewrite instruction, stored beside the rest of the harness home. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SYSTEM_PROMPT, MAX_PROMPT_CHARS } from './defaults.js';

/** Harness home, matching how every other DSH package resolves it. */
export function dshHome() {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
}

/** Absolute path of this plugin's settings file. */
export function settingsPath() {
  return path.join(dshHome(), 'prompt-optimizer.json');
}

/**
 * Normalize a candidate instruction.
 * @param value - arbitrary stored or submitted value.
 * @returns the trimmed prompt, or undefined when it is unusable.
 */
export function normalizePrompt(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text === '' || text.length > MAX_PROMPT_CHARS) return undefined;
  return text;
}

/**
 * Read the effective instruction.
 *
 * A missing, unreadable, or malformed file is not an error: the built-in
 * instruction applies, so the button keeps working before the user ever opens
 * the settings page.
 * @param file - settings file to read.
 * @returns the effective prompt, whether it is user-supplied, and the file path.
 */
export function readSettings(file = settingsPath()) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const prompt = normalizePrompt(raw?.systemPrompt);
    if (prompt !== undefined) return { systemPrompt: prompt, custom: true, file };
  } catch {
    /* absent or unparsable: fall through to the built-in instruction */
  }
  return { systemPrompt: DEFAULT_SYSTEM_PROMPT, custom: false, file };
}

/**
 * Persist one instruction atomically (write a sibling temp file, then rename).
 * @param systemPrompt - candidate instruction.
 * @param file - settings file to write.
 * @returns `{ok:true, systemPrompt}` or `{ok:false, code}`.
 */
export function writeSettings(systemPrompt, file = settingsPath()) {
  const prompt = normalizePrompt(systemPrompt);
  if (prompt === undefined) return { ok: false, code: 'invalid_prompt' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ systemPrompt: prompt }, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return { ok: true, systemPrompt: prompt };
}

/**
 * Drop the stored instruction so the built-in one applies again.
 * @param file - settings file to remove.
 * @returns the built-in instruction.
 */
export function resetSettings(file = settingsPath()) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* already gone */
  }
  return { ok: true, systemPrompt: DEFAULT_SYSTEM_PROMPT };
}
