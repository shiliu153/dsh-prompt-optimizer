/**
 * Host half of the prompt-optimizer bundle.
 *
 * It owns two things: the `/api/dsh-prompt-optimizer` Fetch routes the browser
 * calls, and the rewrite itself, which runs through `ctx.llm` with the provider
 * and model the composer's model selector reports. The browser never picks a
 * different model than the one the user sees.
 *
 * Both services are optional children, so a profile without the Web connection
 * (or without an LLM service) keeps the plugin inactive instead of failing to
 * activate.
 */
import { createRoutes } from './lib/routes.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-prompt-optimizer';

export function apply(ctx) {
  ctx.inject(['connection', 'llm'], (scope) => {
    for (const route of createRoutes({ llm: scope.llm })) {
      scope.connection.registerFetchRoute(scope, route);
    }
  });
}
