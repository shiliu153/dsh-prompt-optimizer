# dsh-prompt-optimizer for DSH

[English](README.en.md) | [中文](README.md)

A [DeepSeek Harness](https://github.com/topics/dsh-plugin) bundle that adds one button
to the left of the composer's model selector: it rewrites the draft with **the model
you have selected** and puts the result back into the composer. The rewrite
instruction itself is editable in Settings.

## Install

From the repository:

```
plugin_manager install_bundle https://github.com/shiliu153/dsh-prompt-optimizer
```

From a local checkout while developing (code changes need a restart):

```
plugin_manager install_bundle C:\Users\20157\daily_work\dsh-prompt-optimizer
```

The button appearing in the composer toolbar is the success signal: it means the
bundle is mounted. A missing button means the bundle did not activate — not that a
model is unavailable.

## Use

| Action | Result |
|---|---|
| Empty draft | Button disabled; the tooltip asks for content first |
| Click with a model selected | That model rewrites the whole draft; the composer content is replaced |
| Click with no model selected | No request; a bubble above the button says to select a model |
| While a rewrite runs | The icon becomes a spinner and the button is disabled |
| Rewrite fails | The draft is untouched; the reason shows in the bubble for 8 seconds |

The replacement is a whole-document write: the editor merges it into the current
history entry instead of pushing a separate undo step. If you keep typing while a
rewrite runs, the result does not overwrite your text — the button reports that the
draft changed and leaves it alone.

## Settings

`Settings → Prompt Optimizer` edits the system prompt sent to the model, with
**Save** and **Restore default**.

- Stored at `$DSH_HOME/prompt-optimizer.json` (default `~/.dsh/prompt-optimizer.json`) as `{ "systemPrompt": "…" }`.
- Read on every request, so a saved instruction applies to the next click without a restart.
- A missing or unparsable file falls back to the built-in instruction; the button keeps working.
- The limit is 8000 characters; an empty instruction is refused, so use **Restore default** instead.

## HTTP surface

Four exact-path routes on the harness's own `/api` channel
(`ctx.connection.registerFetchRoute`), so the origin checks and browser-session
authentication run before any handler.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/dsh-prompt-optimizer/optimize` | `{provider, model, text}` | `{text}` |
| GET | `/api/dsh-prompt-optimizer/settings` | — | `{systemPrompt, custom, defaultPrompt, maxChars, file}` |
| POST | `/api/dsh-prompt-optimizer/settings/save` | `{systemPrompt}` | same view |
| POST | `/api/dsh-prompt-optimizer/settings/reset` | — | same view |

## How it works

```
client.js  ──slots──▶ conversation.input.right (button) + settings.section (page)
     │ fetch('/api/dsh-prompt-optimizer/…')
     ▼
Host index.js → lib/optimize.js
     ├─ validateRequest      empty / oversized / no model, refused before any provider call
     ├─ ctx.llm.prepareCall  binds provider + model + maxTokens, lowest advertised effort
     └─ call.stream          accumulates text-delta only; finish.reason decides the outcome
     ▼
the provider/model currently selected in the composer
```

Three decisions carry the design:

1. **The selector owns the model.** Each click reads
   `ctx.modelDirectories.directoryFor(sessionId).store.getSnapshot().current`, so a
   switch made in the menu is what the next click uses. The plugin has no model
   configuration of its own.
2. **Lowest reasoning effort.** A rewrite is a short-output task; the lowest
   advertised effort keeps latency down without downgrading the model.
3. **No streaming into the composer.** One replacement avoids fighting the editor's
   undo stack and caret.

## Structure

```
index.js            Host half: apply + ctx.inject(['connection','llm'])
lib/defaults.js     built-in instruction and limits
lib/settings.js     settings file I/O (atomic write, corrupt-file fallback)
lib/optimize.js     validation + prepareCall/stream + finish mapping
lib/routes.js       the four Fetch routes
client.js           browser half: button + settings page (no Harness Client packages)
locale/             bundle metadata (en / zh meta.title and meta.description)
scripts/            check-bundle.mjs: bundle compliance self-check
test/               node --test
docs/               specs / plans / records
cordis.patch.yml    this bundle's own patch, registering dsh-prompt-optimizer
```

`lib/` has no external dependencies: `test/esm-hygiene.test.mjs` asserts that Host
sources never call `require()` and only import `node:` builtins or relative files.

## Known limitations

- **The replacement is not guaranteed to be one undo step.** `inputActions.setDraft`
  is the editor's whole-document write and its history entry is merged
  (`history-merge`), so Ctrl+Z may not land exactly on the pre-rewrite text. Copy
  the original first if you need a reliable way back.
- **Typing during a rewrite discards the result.** The click records the draft
  revision; if it changed by the time the answer arrives, nothing is replaced and
  the button says so.
- **Whole-draft rewrites only.** Optimizing a selection needs an insert back at the
  exact range and has more failure paths; this version does not attempt it.
- **No diff preview.** The result replaces the draft and undo is the way back.
- **No streaming display.** The composer changes only on completion or failure.
- **Reasoning effort is fixed to the lowest level** and is not configurable.
- **Drafts over 20000 characters are refused** (413). The bound lives in
  `lib/defaults.js`, so changing it is a code change.
- **Updating this bundle's code needs a process restart** to load a new JavaScript
  module generation; HMR only reloads configuration.
- **A rewrite is not a session turn.** It edits the composer, so it adds no session
  event (the draft itself is persisted by DSH).

## Failure behavior

Every failure happens before replacement: the draft is untouched and the reason
appears in the bubble above the button.

| Case | Handling |
|---|---|
| Empty draft | Button disabled, no request |
| No model selected | No request; "select a model" bubble |
| Draft over 20000 characters | 413 `too_long` |
| Provider not registered | 400 `NO_ADAPTER` from the LLM service |
| Missing credential / rate limit / context window | 502 with the provider-neutral code and message |
| Model returns no text | 502 `empty_response`, draft untouched |
| No completion within 120s | 504 `timeout` |
| Session switched mid-flight | Result discarded |
| Draft edited while the rewrite ran | Not applied; the button reports the change |
| Body is not JSON | 400 `bad_request` |

## Development

```sh
node --test "test/*.test.mjs"        # 23 tests, zero dependencies
node scripts/check-bundle.mjs .      # bundle compliance self-check, non-zero on failure
```

Installing into a local profile (the same steps DSH's installer performs):

```sh
# ~/.dsh/profiles/<profile>/package.json
#   dependencies: "@dsh-contrib/dsh-prompt-optimizer": "link:<absolute path to this directory>"
#   dsh.profile.bundles: append "@dsh-contrib/dsh-prompt-optimizer"
cd ~/.dsh/profiles/<profile>
node <pnpm>/bin/pnpm.cjs install
```

Restart the DSH desktop app after changing this bundle's code.
