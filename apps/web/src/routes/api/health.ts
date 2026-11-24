import { createFileRoute } from '@tanstack/react-router'
import { handleLivenessProbe } from './health.live'
import { SEEN_HOST_HEADER } from '@/lib/server/domains/domain-proof/seen-host'
import { requestWorkspaceHost } from '@/lib/server/workspaces/saas-edge-host'

/**
 * Liveness, naming the host it was asked on (`SEEN_HOST_HEADER`), so the
 * custom domain check can tell that this server sees the hostname it asked for.
 */
export function handleHealthProbe(request: Request): Response {
  const res = handleLivenessProbe()
  const host = requestWorkspaceHost(request)
  if (host) res.headers.set(SEEN_HOST_HEADER, host)
  return res
}

// Legacy probe path; /api/health/live is the canonical liveness endpoint.
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: ({ request }) => handleHealthProbe(request),
    },
  },
})
