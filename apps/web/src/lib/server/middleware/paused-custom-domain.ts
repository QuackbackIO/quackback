/**
 * The custom domain while it is paused after the plan limits grace: a 301 to
 * the workspace's own hostname, and links generated on it.
 *
 * Registered right after workspace resolution, because the decision reads the
 * workspace's settings and plan state, which need the scope that resolution
 * opens. Everything real is behind a dynamic import: `start.ts` is a client
 * entry as well as a server one. The implementation lives in
 * `domains/plan-limits/plan-limits.custom-domain.ts`.
 */
import { createMiddleware } from '@tanstack/react-start'

export const pausedCustomDomainMiddleware = createMiddleware().server(async ({ next, request }) => {
  const { handlePausedCustomDomain } =
    await import('@/lib/server/domains/plan-limits/plan-limits.custom-domain')
  return handlePausedCustomDomain({ request, next: () => Promise.resolve(next()) })
})
