// Browser half of the prompt-optimizer bundle.
//
// Single self-contained file: the client module is served directly at
// /plugins/<id>/client.js and cannot require sibling files of this package.
// React comes from the browser module table; nothing else is imported, because
// Harness Client packages are not a stable module surface.
window.__ModuleLoader__.load({
  id: '@dsh-contrib/dsh-prompt-optimizer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dshPromptOptimizer';
    const API = '/api/dsh-prompt-optimizer';

    const ZH = {
      action: '优化提示词',
      emptyDraft: '先输入内容，再用当前模型优化',
      noModel: '请先在模型选择器里选一个模型',
      emptyResponse: '模型没有返回任何文本',
      cancel: '取消优化',
      nav: '提示词优化',
      settingsTitle: '提示词优化',
      settingsDesc: '输入框工具栏上的按钮会用当前选择的模型改写草稿。这里编辑发给模型的指令，保存后下一次点击立即生效。',
      promptLabel: '优化指令（系统提示词）',
      promptHint: '要求模型只输出改写后的提示词本身；保存时会去掉首尾空白。',
      sourceCustom: '当前使用自定义指令',
      sourceDefault: '当前使用内置指令',
      chars: '{count} / {max} 字符',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      reset: '恢复默认',
      resetDone: '已恢复内置指令',
      loadFailed: '读取设置失败：{error}',
      saveFailed: '保存失败：{error}',
      loading: '加载中…',
    };
    const EN = {
      action: 'Optimize prompt',
      emptyDraft: 'Type something first',
      noModel: 'Select a model first',
      emptyResponse: 'The model returned no text',
      cancel: 'Cancel optimization',
      nav: 'Prompt Optimizer',
      settingsTitle: 'Prompt Optimizer',
      settingsDesc:
        'The composer button rewrites your draft with the model you selected. Edit the instruction sent to the model here; a saved instruction applies to the next click.',
      promptLabel: 'Instruction (system prompt)',
      promptHint:
        'Ask the model for the rewritten prompt alone. Leading and trailing whitespace is trimmed on save.',
      sourceCustom: 'Using your custom instruction',
      sourceDefault: 'Using the built-in instruction',
      chars: '{count} / {max} characters',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      reset: 'Restore default',
      resetDone: 'Built-in instruction restored',
      loadFailed: 'Could not read settings: {error}',
      saveFailed: 'Could not save: {error}',
      loading: 'Loading…',
    };

    // ---- pure helpers (unit-tested through __test) ----

    /** True when the composer's model selector reports a usable route. */
    function isModelReady(model) {
      return Boolean(
        model &&
          typeof model.provider === 'string' &&
          model.provider !== '' &&
          typeof model.model === 'string' &&
          model.model !== '',
      );
    }

    /** The exact body one click sends. */
    function buildRequest(text, model) {
      return { provider: model.provider, model: model.model, text };
    }

    /** The message to show for a rejected rewrite. */
    function errorText(status, body) {
      const message = body && body.error && body.error.message;
      if (typeof message === 'string' && message !== '') return message;
      return 'HTTP ' + String(status);
    }

    // ---- components ----

    // Colours are theme tokens only, and the control copies the host's own
    // composer `+` button (28px circle, selector fill, solid hover) so the row
    // reads as one toolbar. A renamed token degrades the look, never rendering.
    const CSS = `
.dsh-po-root { position: relative; display: inline-flex; align-items: center; flex: none; }
.dsh-po-button { corner-shape: round; box-sizing: border-box; background: var(--dsw-specific-selector); width: 28px; height: 28px; color: var(--dsw-alias-label-primary); cursor: pointer; border: none; border-radius: 999px; flex: none; place-items: center; display: grid; padding: 0; }
.dsh-po-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid); }
.dsh-po-button:disabled { opacity: 0.5; cursor: default; }
.dsh-po-button:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsh-po-spin { animation: dsh-po-spin 900ms linear infinite; transform-origin: 50% 50%; }
@keyframes dsh-po-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dsh-po-spin { animation-duration: 2400ms; } }
/* Both icons share one grid cell: the spinner shows progress, and hover or
 * keyboard focus swaps it for the cancel mark so the same button can stop it. */
.dsh-po-button > svg { grid-area: 1 / 1; }
.dsh-po-cancel { display: none; }
.dsh-po-button[data-busy='true']:hover .dsh-po-cancel, .dsh-po-button[data-busy='true']:focus-visible .dsh-po-cancel { display: block; }
.dsh-po-button[data-busy='true']:hover .dsh-po-spin, .dsh-po-button[data-busy='true']:focus-visible .dsh-po-spin { display: none; }
.dsh-po-error { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 40; max-width: 280px; width: max-content; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; padding: 8px 10px; }
.dsh-po-section { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 24px; }
.dsh-po-h { margin: 0; color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 600; line-height: 24px; }
.dsh-po-p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dsh-po-label { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
.dsh-po-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-po-input { box-sizing: border-box; width: 100%; min-height: 220px; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 13px; line-height: 20px; padding: 10px 12px; border-radius: var(--dsw-radius-md); border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); }
.dsh-po-input:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.dsh-po-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-po-actions { display: flex; align-items: center; gap: 8px; }
.dsh-po-btn { font-size: 13px; line-height: 20px; padding: 5px 14px; border-radius: var(--dsw-radius-md); border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.dsh-po-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-po-btn:disabled { opacity: 0.5; cursor: default; }
.dsh-po-btn:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsh-po-btn[data-primary='true'] { background: var(--dsw-alias-brand-primary); border-color: transparent; color: var(--dsw-alias-label-primary-foreground); }
.dsh-po-status { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-po-status[data-error='true'] { color: var(--dsw-alias-state-error-primary); }
`;

    /** The 14px sparkle mark, drawn here so no Client package is imported. */
    function SparkleIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M7.2 1.8 8.6 5.4 12.2 6.8 8.6 8.2 7.2 11.8 5.8 8.2 2.2 6.8 5.8 5.4z',
          fill: 'currentColor',
        }),
        h('path', {
          d: 'M12.1 10.2 12.9 12.1 14.8 12.9 12.9 13.7 12.1 15.6 11.3 13.7 9.4 12.9 11.3 12.1z',
          fill: 'currentColor',
          opacity: '0.7',
        }),
      );
    }

    function SpinnerIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, className: 'dsh-po-spin' },
        h('circle', {
          cx: 8,
          cy: 8,
          r: 5.5,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeDasharray: '9 26',
        }),
      );
    }

    /** The cancel mark that replaces the spinner once the running button is hovered. */
    function CancelIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, className: 'dsh-po-cancel' },
        h('path', {
          d: 'M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
        }),
      );
    }

    /**
     * The composer button: rewrite the whole draft with the selected model.
     *
     * Clicking while a rewrite runs cancels it. The browser aborts the fetch, the
     * harness bridge turns the closed socket into an aborted request signal, and
     * the provider call stops with it — so a cancel also stops the tokens being
     * generated, not just the display of them.
     *
     * An answer that arrives anyway replaces the draft as it stands. The click is
     * the authority: text typed while the rewrite ran is overwritten rather than
     * turning the result into an error.
     */
    function OptimizeButton(props) {
      const t = props.t;
      const draft = props.useInput((s) => s.draft);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const alive = React.useRef(true);
      const inflight = React.useRef(null);

      React.useEffect(
        () => () => {
          alive.current = false;
          inflight.current?.abort();
          inflight.current = null;
        },
        [],
      );

      React.useEffect(() => {
        if (error === '') return undefined;
        const timer = setTimeout(() => setError(''), 8000);
        return () => clearTimeout(timer);
      }, [error]);

      const empty = draft.trim() === '';
      // A running rewrite stays clickable: the same button cancels it.
      const disabled = busy ? false : empty;

      async function run() {
        if (busy) {
          inflight.current?.abort();
          return;
        }
        const text = draft;
        const model = props.readModel();
        if (!isModelReady(model)) {
          setError(t('noModel'));
          return;
        }
        const controller = new AbortController();
        inflight.current = controller;
        setBusy(true);
        setError('');
        try {
          const response = await fetch(`${API}/optimize`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildRequest(text, model)),
            signal: controller.signal,
          });
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(errorText(response.status, body));
          const next = body && typeof body.text === 'string' ? body.text : '';
          if (next === '') throw new Error(t('emptyResponse'));
          if (!alive.current || controller.signal.aborted) return;
          props.inputActions.setDraft(next);
        } catch (e) {
          // A cancel is the user's own doing: no bubble, no message.
          if (controller.signal.aborted) return;
          if (alive.current) setError(String((e && e.message) || e));
        } finally {
          if (inflight.current === controller) inflight.current = null;
          if (alive.current) setBusy(false);
        }
      }

      return h(
        'span',
        { className: 'dsh-po-root' },
        h('style', null, CSS),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-po-button',
            'data-busy': busy ? 'true' : undefined,
            'aria-label': busy ? t('cancel') : t('action'),
            title: busy ? t('cancel') : empty ? t('emptyDraft') : error !== '' ? error : t('action'),
            'aria-busy': busy ? 'true' : undefined,
            disabled,
            onClick: run,
          },
          busy ? h(SpinnerIcon) : h(SparkleIcon),
          busy ? h(CancelIcon) : null,
        ),
        error !== ''
          ? h('span', { className: 'dsh-po-error', role: 'alert' }, error)
          : null,
      );
    }

    /**
     * The settings page: read, edit, save, and reset the rewrite instruction.
     *
     * The stored value lives beside the harness home rather than in the profile
     * patch, so the page is the single place that owns it.
     */
    function SettingsSection(props) {
      const t = props.t;
      const [state, setState] = React.useState({ status: 'loading' });
      const [draft, setDraft] = React.useState('');
      const [note, setNote] = React.useState({ text: '', error: false });
      const [busy, setBusy] = React.useState('');
      const inputId = React.useId();
      const alive = React.useRef(true);

      React.useEffect(
        () => () => {
          alive.current = false;
        },
        [],
      );

      const applyPayload = React.useCallback((payload) => {
        if (!alive.current) return;
        setState({
          status: 'ready',
          custom: payload.custom === true,
          defaultPrompt: typeof payload.defaultPrompt === 'string' ? payload.defaultPrompt : '',
          maxChars: typeof payload.maxChars === 'number' ? payload.maxChars : 8000,
          file: typeof payload.file === 'string' ? payload.file : '',
        });
        setDraft(typeof payload.systemPrompt === 'string' ? payload.systemPrompt : '');
      }, []);

      React.useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const response = await fetch(`${API}/settings`);
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error(errorText(response.status, body));
            if (!cancelled) applyPayload(body);
          } catch (e) {
            if (!cancelled && alive.current) {
              setState({ status: 'error' });
              setNote({ text: t('loadFailed', { error: String((e && e.message) || e) }), error: true });
            }
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [applyPayload, t]);

      async function send(path, body) {
        setBusy(path);
        setNote({ text: '', error: false });
        try {
          const response = await fetch(`${API}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(errorText(response.status, payload));
          applyPayload(payload);
          setNote({ text: path.endsWith('/reset') ? t('resetDone') : t('saved'), error: false });
        } catch (e) {
          if (alive.current) setNote({ text: t('saveFailed', { error: String((e && e.message) || e) }), error: true });
        } finally {
          if (alive.current) setBusy('');
        }
      }

      const maxChars = state.status === 'ready' ? state.maxChars : 8000;
      const tooLong = draft.length > maxChars;
      const canSave = state.status === 'ready' && draft.trim() !== '' && !tooLong && busy === '';

      return h(
        'div',
        { className: 'dsh-po-section' },
        h('style', null, CSS),
        h('h2', { className: 'dsh-po-h' }, t('settingsTitle')),
        h('p', { className: 'dsh-po-p' }, t('settingsDesc')),
        state.status === 'loading' ? h('div', { className: 'dsh-po-status' }, t('loading')) : null,
        h('label', { className: 'dsh-po-label', htmlFor: inputId }, t('promptLabel')),
        h('textarea', {
          id: inputId,
          className: 'dsh-po-input',
          value: draft,
          spellCheck: false,
          disabled: state.status !== 'ready',
          onChange: (event) => setDraft(event.target.value),
        }),
        h('div', { className: 'dsh-po-hint' }, t('promptHint')),
        h(
          'div',
          { className: 'dsh-po-meta' },
          h('span', null, t('chars', { count: String(draft.length), max: String(maxChars) })),
          h(
            'span',
            null,
            state.status === 'ready'
              ? state.custom
                ? t('sourceCustom')
                : t('sourceDefault')
              : '',
          ),
        ),
        h(
          'div',
          { className: 'dsh-po-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-po-btn',
              'data-primary': 'true',
              disabled: !canSave,
              onClick: () => send('/settings/save', { systemPrompt: draft }),
            },
            busy === '/settings/save' ? t('saving') : t('save'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-po-btn',
              disabled: state.status !== 'ready' || busy !== '',
              onClick: () => send('/settings/reset'),
            },
            t('reset'),
          ),
        ),
        note.text !== ''
          ? h('div', { className: 'dsh-po-status', 'data-error': note.error ? 'true' : undefined, role: 'status' }, note.text)
          : null,
        state.status === 'ready' && state.file !== ''
          ? h('div', { className: 'dsh-po-hint' }, state.file)
          : null,
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-prompt-optimizer: dictionaries');
        const t = ctx.locale.bind(NS);

        // The model seat owns the per-session directory; read it at click time so
        // a switch made in the menu is what the next click uses.
        ctx.inject(['slots', 'modelDirectories'], (scope) => {
          const models = scope.modelDirectories;
          scope.slots.inject('conversation.input.right', () =>
            scope.slots.register(
              {
                name: 'conversation.input.right',
                id: 'prompt-optimizer',
                order: 20,
                locale: NS,
                inject: (sessionId) => ({
                  t,
                  readModel: () => {
                    try {
                      return models.directoryFor(sessionId).store.getSnapshot().current;
                    } catch {
                      return undefined;
                    }
                  },
                }),
              },
              OptimizeButton,
            ),
          );
        });

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'prompt-optimizer',
              order: 60,
              locale: NS,
              label: () => t('nav'),
              inject: () => ({ t }),
            },
            SettingsSection,
          ),
        );
      },
      __test: { NS, API, isModelReady, buildRequest, errorText, ZH, EN },
    };
  },
});
