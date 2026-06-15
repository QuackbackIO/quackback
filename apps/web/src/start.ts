/**
 * TanStack Start global configuration entry.
 *
 * Registers global request middleware that runs for every server request
 * (SSR, server routes, server functions).
 *
 * IMPORTANT: defining this file means our `requestMiddleware` list REPLACES the
 * CSRF middleware TanStack Start auto-installs when no start instance exists
 * (see start-server-core createStartHandler). So CSRF must be included here
 * explicitly, otherwise server-function mutations would silently lose
 * same-origin protection in production (the omission warning is dev-only).
 */
import { createStart, createCsrfMiddleware } from '@tanstack/react-start'
import { requestContextMiddleware } from '@/lib/server/middleware/request-context'

/**
 * Same-origin protection for server functions, matching the framework default.
 *
 * It guards `handlerType === 'serverFn'` only — the cookie-authed RPC surface
 * (admin/portal UI). API routes are `handlerType === 'router'` and are left
 * alone, which is correct: the embeddable widget's cross-origin calls go to
 * `/api/widget/*` with `Authorization: Bearer` + `credentials: 'omit'` (no
 * cookies), so they are not CSRF-vulnerable and must not be blocked.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => {
  return {
    // Request-context/logging first so even CSRF-rejected requests get a
    // request_id and an access log; CSRF second.
    requestMiddleware: [requestContextMiddleware, csrfMiddleware],
  }
})
