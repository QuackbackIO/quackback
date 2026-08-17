/**
 * Best-effort HTTP nudge from a web replica to the worker.
 *
 * The in-process activity signal cannot cross the web/worker split. This is
 * the deliberately dumb replacement: one POST, 2s timeout, response ignored,
 * errors swallowed at debug, 5s per-workspace throttle. No ack, no retry, no
 * durable fallback. A lost nudge is bounded by the rescan floor.
 *
 * `QUACKBACK_WORKER_WAKE_URL` unset — the self-host `role=all` path — is a
 * no-op. The in-process signal already covers that topology.
 */
import { logger } from '@/lib/server/logger'
import { FLEET_INTERNAL_TOKEN_ENV } from '@/lib/server/fleet/internal-auth'

const log = logger.child({ component: 'worker-wake-nudge' })

const THROTTLE_MS = 5_000
const TIMEOUT_MS = 2_000

const lastByWorkspace = new Map<string, number>()

/** Test seam. */
export function __resetWakeNudgeForTests(): void {
  lastByWorkspace.clear()
}

function wakeUrl(raw: string): string {
  const trimmed = raw.replace(/\/$/, '')
  if (trimmed.endsWith('/api/internal/wake')) return trimmed
  return `${trimmed}/api/internal/wake`
}

/**
 * Fire-and-forget. Must never be awaited on the request path: a hung worker
 * must not slow a web response.
 */
export function nudgeWorker(workspaceKey: string): void {
  const raw = process.env.QUACKBACK_WORKER_WAKE_URL
  if (!raw) return
  if (!workspaceKey) return

  const now = Date.now()
  const last = lastByWorkspace.get(workspaceKey) ?? 0
  if (now - last < THROTTLE_MS) return
  lastByWorkspace.set(workspaceKey, now)

  const url = wakeUrl(raw)
  const token = process.env[FLEET_INTERNAL_TOKEN_ENV]
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`

  void fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ workspaceKey }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
    .then((res) => {
      // Deliberately unread. A 401 or 5xx is the same as a timeout: the
      // rescan still drains the work.
      void res.body?.cancel()
    })
    .catch((err) => {
      log.debug({ err, workspaceKey }, 'worker wake nudge failed')
    })
}
