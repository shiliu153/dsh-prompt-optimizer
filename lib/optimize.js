/** One rewrite: validate the draft, stream the selected model, return its text. */
import { MAX_INPUT_CHARS, MAX_OUTPUT_TOKENS, TIMEOUT_MS } from './defaults.js';

/**
 * Check the request body before any provider work happens.
 * @param body - parsed request body.
 * @returns `{value}` with normalized fields, or `{error}` with a status.
 */
export function validateRequest(body) {
  const text = typeof body?.text === 'string' ? body.text : '';
  const provider = typeof body?.provider === 'string' ? body.provider.trim() : '';
  const model = typeof body?.model === 'string' ? body.model.trim() : '';
  if (text.trim() === '') {
    return { error: { code: 'empty_input', message: 'the draft is empty', status: 400 } };
  }
  if (text.length > MAX_INPUT_CHARS) {
    return {
      error: {
        code: 'too_long',
        message: `the draft is ${text.length} characters; the limit is ${MAX_INPUT_CHARS}`,
        status: 413,
      },
    };
  }
  if (provider === '' || model === '') {
    return { error: { code: 'no_model', message: 'no model is selected', status: 400 } };
  }
  return { value: { text, provider, model } };
}

/**
 * The request-only user input one rewrite sends.
 * @param text - draft being rewritten.
 * @returns a one-message conversation.
 */
export function requestMessages(text) {
  return [{ role: 'user', content: [{ type: 'text', text }] }];
}

/**
 * Least advertised reasoning effort for a model, so a rewrite stays fast.
 * @param modelInfo - resolved model metadata handed to the configure callback.
 * @returns an effort id, or undefined when the adapter advertises none.
 */
export function pickEffort(modelInfo) {
  const efforts = modelInfo?.reasoning?.efforts;
  if (!Array.isArray(efforts) || efforts.length === 0) return undefined;
  const id = efforts[0]?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** Map a thrown value to the route's error envelope. */
function failureOf(error) {
  const code = typeof error?.code === 'string' && error.code !== '' ? error.code : 'llm_error';
  const message =
    typeof error?.message === 'string' && error.message !== '' ? error.message : String(error);
  return { code, message, status: code === 'NO_ADAPTER' ? 400 : 502 };
}

/**
 * Rewrite one draft with the caller-selected provider and model.
 *
 * Resolves to `{value:{text}}` on success and `{error}` on every failure; it
 * never throws, because the route answers with a JSON envelope either way.
 * @param options.llm - the harness LLM service.
 * @param options.settings - effective rewrite instruction.
 * @param options.body - parsed request body.
 * @param options.signal - caller cancellation (the HTTP request's own signal).
 * @returns the rewritten prompt, or a coded error.
 */
export async function optimizeDraft({ llm, settings, body, signal }) {
  const checked = validateRequest(body);
  if (checked.error) return { error: checked.error };
  const { text, provider, model } = checked.value;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal?.aborted === true) controller.abort();
  else signal?.addEventListener?.('abort', onAbort, { once: true });

  try {
    let call;
    try {
      call = await llm.prepareCall(
        { provider, model, maxTokens: MAX_OUTPUT_TOKENS },
        controller.signal,
        (controls, modelInfo) => {
          const effort = pickEffort(modelInfo);
          return effort === undefined ? controls : { ...controls, reasoningEffort: effort };
        },
      );
    } catch (error) {
      return { error: timedOut ? { code: 'timeout', message: 'the model call timed out', status: 504 } : failureOf(error) };
    }

    let output = '';
    let reason;
    try {
      const stream = call.stream({
        ...call.config,
        system: settings.systemPrompt,
        messages: requestMessages(text),
        signal: controller.signal,
      });
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta') output += chunk.text;
        else if (chunk?.type === 'finish') reason = chunk.reason;
      }
    } catch (error) {
      return { error: timedOut ? { code: 'timeout', message: 'the model call timed out', status: 504 } : failureOf(error) };
    }

    if (timedOut) return { error: { code: 'timeout', message: 'the model call timed out', status: 504 } };
    if (reason?.kind === 'aborted') {
      return {
        error: {
          code: 'aborted',
          message: reason.failure?.message ?? 'the request was cancelled',
          status: 499,
        },
      };
    }
    if (reason?.kind === 'error') {
      return {
        error: {
          code: reason.failure?.code ?? 'llm_error',
          message: reason.failure?.message ?? 'the model call failed',
          status: 502,
        },
      };
    }

    const cleaned = output.trim();
    if (cleaned === '') {
      return { error: { code: 'empty_response', message: 'the model returned no text', status: 502 } };
    }
    return { value: { text: cleaned } };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
