# dsh-prompt-optimizer for DSH

[English](README.en.md) | [中文](README.md)

> **Unmaintained.** The feature is covered by the existing `dsh-prompt-optimizer@2.0.3`
> package; this repository is kept as an archive and is no longer updated.

A [DeepSeek Harness](https://github.com/topics/dsh-plugin) bundle that adds one button
to the left of the composer's model selector: it rewrites the draft with **the model
you have selected** and puts the result back into the composer. The rewrite
instruction itself is editable in Settings.

## Install

The standard way: open **Plugins** in the DSH Web sidebar, choose **Add plugin**, and
put the repository address in the package field:

```
https://github.com/shiliu153/dsh-prompt-optimizer
```

Then choose **Enable now**. The page first has the Host read the spec, then runs pnpm
and adds the package to the current profile's bundles — do not edit the profile's
`package.json` by hand.

If this plugin was installed earlier as a local directory link (`link:`), remove it
from its card first and install again from the address above: installing a package
that already exists in the same profile is refused.

The equivalent agent call (only where the `plugin_manager` tool is enabled; Desktop
ships it switched off):

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
| While a rewrite runs | The icon becomes a spinner; clicking again cancels it (the mark turns into a cross on hover) |
| Rewrite fails | The draft is untouched; the reason shows in the bubble for 8 seconds |

The replacement is a whole-document write: the editor merges it into the current
history entry instead of pushing a separate undo step. If you keep typing while a
rewrite runs, the answer replaces that text when it arrives — the click is the
authority and the button does not turn it into an error. Cancel instead if you no
longer want it.

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
- **Typing during a rewrite is overwritten.** The draft captured at click time is
  the input; whatever is in the composer when the answer arrives is replaced. Cancel
  mid-flight if you want to keep it.
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
| Cancelled mid-flight | Request aborted, draft untouched, no error |
| Body is not JSON | 400 `bad_request` |

## Development

```sh
node --test "test/*.test.mjs"        # 22 tests, zero dependencies
node scripts/check-bundle.mjs .      # bundle compliance self-check, non-zero on failure
```

Install into a profile only through the standard channel: **Plugins → Add plugin**,
where the Host reads the spec, runs pnpm, and selects the bundle in one pass. Do not
hand-write the profile's `package.json` or `dsh.profile.bundles`, and do not run pnpm
in the profile directory yourself — those are the three steps the page performs, and
doing them by hand skips its validation and selection.

Restart the DSH desktop app after changing this bundle's code.
