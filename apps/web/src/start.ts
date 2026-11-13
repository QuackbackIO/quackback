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
import { oauthCorsMiddleware } from '@/lib/server/middleware/oauth-cors'
import { requestContextMiddleware } from '@/lib/server/middleware/request-context'
import { userContentHostMiddleware } from '@/lib/server/middleware/user-content-host'
import { serverFnLogMiddleware } from '@/lib/server/middleware/server-fn-log'
import { workspaceContextMiddleware } from '@/lib/server/middleware/workspace-context'
import { auditAttributionMiddleware } from '@/lib/server/middleware/audit-attribution'
import { expireRouteContextOnWrite } from '@/lib/client/route-context-middleware'
import { serverFnFetch } from '@/lib/client/server-fn-fetch'
import { liftErrorReferenceOnFailure } from '@/lib/client/error-reference-middleware'

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
    // request_id and an access log. Workspace resolution second — before CSRF and
    // before auth, because auth is full of `db` queries and cannot run until the
    // database has been chosen (SAAS-HOSTING-STACK.md §6). Under
    // QUACKBACK_TENANCY=single it is a pass-through.
    // OAuth/MCP CORS answers preflights before workspace resolution: a
    // preflight carries no credentials and needs no database.
    // The user-content host (USER_CONTENT_URL) is narrowed to stored-file
    // reads before anything else looks at the request.
    // Audit attribution last: it opens the request's attribution boundary, and
    // anything it records must land in the workspace resolved above.
    requestMiddleware: [
      requestContextMiddleware,
      userContentHostMiddleware,
      oauthCorsMiddleware,
      workspaceContextMiddleware,
      csrfMiddleware,
      auditAttributionMiddleware,
    ],
    // Server-function failures never reach the request middleware's error
    // branch (see server-fn-log.ts), so they are logged here instead. Unlike
    // `requestMiddleware` above, this list replaces no framework default.
    // In the browser, a POST server function drops the route context kept
    // between navigations, so the next one sees what it changed.
    // A technical failure hidden by the server arrives with its reference code
    // in the message; the browser lifts it off before anything prints it.
    functionMiddleware: [
      serverFnLogMiddleware,
      expireRouteContextOnWrite,
      liftErrorReferenceOnFailure,
    ],
    // In the browser, a 5xx that did not come from the function itself fails
    // the call instead of resolving as its result (see server-fn-fetch.ts).
    serverFns: { fetch: serverFnFetch },
  }
})
