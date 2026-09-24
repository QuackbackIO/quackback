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
import { compressionMiddleware } from '@/lib/server/middleware/compression'
import { oauthCorsMiddleware } from '@/lib/server/middleware/oauth-cors'
import { requestContextMiddleware } from '@/lib/server/middleware/request-context'
import { serverFnLogMiddleware } from '@/lib/server/middleware/server-fn-log'
import { workspaceContextMiddleware } from '@/lib/server/middleware/workspace-context'

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
    // Compression wraps everything else in this array: it only sees the
    // response once every inner middleware has already applied its headers,
    // and it is the last thing to touch the body before it leaves the
    // process. See compression.ts for why the body is streamed through
    // node:zlib rather than the web CompressionStream API.
    // Request-context/logging next so even CSRF-rejected requests get a
    // request_id and an access log. Workspace resolution second — before CSRF and
    // before auth, because auth is full of `db` queries and cannot run until the
    // database has been chosen (SAAS-HOSTING-STACK.md §6). Under
    // QUACKBACK_TENANCY=single it is a pass-through.
    // OAuth/MCP CORS answers preflights before workspace resolution: a
    // preflight carries no credentials and needs no database.
    requestMiddleware: [
      compressionMiddleware,
      requestContextMiddleware,
      oauthCorsMiddleware,
      workspaceContextMiddleware,
      csrfMiddleware,
    ],
    // Server-function failures never reach the request middleware's error
    // branch (see server-fn-log.ts), so they are logged here instead. Unlike
    // `requestMiddleware` above, this list replaces no framework default.
    functionMiddleware: [serverFnLogMiddleware],
  }
})
