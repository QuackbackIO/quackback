/**
 * POST /api/internal/wake — the web replica's doorbell into a detached worker.
 *
 * The in-process activity signal cannot cross the web/worker split. This route
 * is that signal over HTTP: fire-and-forget, no ack, no retry. A lost call
 * costs latency; the poll / deadline / rescan floor still drains the work.
 *
 * Unknown workspace keys still 204 so the response cannot be used to probe the
 * registry. The handler instead kicks a rate-limited fleet refresh so a newly
 * provisioned workspace's loops start without waiting for the next rescan.
 */
import { createFileRoute } from '@tanstack/react-router'
import { logger } from '@/lib/server/logger'
import { shouldRunWorkers } from '@/lib/server/process-role'
import { authorizeFleetInternal } from '@/lib/server/fleet/internal-auth'
import {
  requestWorkspaceLoopRefresh as refreshJobWorkspaceLoops,
  signalWorkspace as signalJobWorkspace,
} from '@/lib/server/jobs/tier'

const log = logger.child({ component: 'internal-wake' })

/** Floor on kicking the job tier to re-read the active workspace set. */
const REFRESH_MIN_MS = 30_000

let lastRefreshAt = 0

/** Test seam: the 30s refresh latch would otherwise hide the second case. */
export function __resetInternalWakeForTests(): void {
  lastRefreshAt = 0
}

function kickLoopRefresh(): void {
  const now = Date.now()
  if (now - lastRefreshAt < REFRESH_MIN_MS) return
  lastRefreshAt = now
  refreshJobWorkspaceLoops()
}

export async function handleInternalWake(request: Request): Promise<Response> {
  if (!authorizeFleetInternal(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let workspaceKey: unknown
  try {
    const body = (await request.json()) as { workspaceKey?: unknown }
    workspaceKey = body.workspaceKey
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (typeof workspaceKey !== 'string' || workspaceKey.length === 0) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  if (!shouldRunWorkers()) {
    log.warn({ workspaceKey }, 'wake received on a process that does not run workers')
    return new Response(null, { status: 204 })
  }

  const job = signalJobWorkspace(workspaceKey)
  if (!job) kickLoopRefresh()
  return new Response(null, { status: 204 })
}

export const Route = createFileRoute('/api/internal/wake')({
  server: { handlers: { POST: ({ request }) => handleInternalWake(request) } },
})
