import { createFileRoute } from '@tanstack/react-router'
import { harnessNotFound, isE2eHarnessEnabled } from '@/lib/server/e2e-harness/gate'

/**
 * Test-only probe for the admin presence switch. The admin app turns presence
 * off in automated browsers; with `?e2e-presence=1` it asks here first and
 * turns presence on only on a 204. 404 unless the e2e harness gate is open
 * (see lib/server/e2e-harness/gate.ts), so the query flag does nothing on a
 * real deployment.
 */
export function handleE2ePresenceProbe(): Response {
  if (!isE2eHarnessEnabled()) return harnessNotFound()
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}

export const Route = createFileRoute('/api/e2e/presence')({
  server: {
    handlers: {
      GET: () => handleE2ePresenceProbe(),
    },
  },
})
