/**
 * Tenant resolution middleware — the Host header decides the database.
 *
 * Registered immediately after `request-context.ts` and **before** everything
 * else, CSRF included. That ordering is the whole point of the piece:
 * `request-context.ts` has always enriched `tenant_id` "once auth resolves", but
 * auth resolution is itself full of `db.query.*` calls, so a tenant decided at
 * that moment is decided long after the connection it was supposed to choose.
 * This runs first, touches only the control database, and hands everything
 * downstream a tenant that is already verified.
 *
 * **Everything real is behind a dynamic import, deliberately.** `start.ts` is a
 * client entry as well as a server one, so anything this module reaches
 * statically is pulled into the browser bundle — and the tenancy module reaches
 * `postgres` and the Drizzle client factory. The import is paid once, on the
 * first request, on the server only.
 *
 * The implementation and its failure-mode table live in
 * `tenancy/request-scope.ts`; this file is only the framework binding.
 */
import { createMiddleware } from '@tanstack/react-start'

export const tenantContextMiddleware = createMiddleware().server(async ({ next, request }) => {
  const { config } = await import('@/lib/server/config')
  if (!config.isPooledTenancy) return next()
  const { resolveTenantAndContinue } = await import('@/lib/server/tenancy/request-scope')
  return resolveTenantAndContinue({ request, next: () => Promise.resolve(next()) })
})
