/**
 * Cloud web → worker job-wake publisher.
 *
 * After-commit on ROLE=web POSTs `{ workspaceKey, jobIds }` to the worker
 * private URL. Fail-open: unset URL, or POST still failing after retries,
 * leaves the row until a later wake or an activity refresh that starts the
 * loop. Never awaited from `handleAppHook`.
 */
import { getProcessRole } from '@/lib/server/process-role'
import { logger } from '@/lib/server/logger'
import { onDurableWorkCommitted, type DurableWork } from '@/lib/server/workspaces/after-commit'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'
import { FLEET_INTERNAL_TOKEN_ENV } from '@/lib/server/fleet/internal-auth'
import type { JobWakeAbort, JobWakeRequest } from './worker'

const log = logger.child({ component: 'job-wake' })

const COALESCE_MS = 10
const WAKE_TIMEOUT_MS = 2_000
const WAKE_ATTEMPTS = 3
const WAKE_RETRY_BACKOFF_MS = [200, 400] as const

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

interface PendingWake {
  workspaceKey: string
  jobIds: Set<string>
  abort?: JobWakeAbort
  timer?: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingWake>()
let unsubscribe: (() => void) | null = null

export function jobWorkerUrl(): string | undefined {
  const raw = process.env.QUACKBACK_JOB_WORKER_URL?.trim()
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username || url.password) return undefined
    return `${url.protocol}//${url.host}`
  } catch {
    return undefined
  }
}

function token(): string | undefined {
  const value = process.env[FLEET_INTERNAL_TOKEN_ENV]
  return value && value.length > 0 ? value : undefined
}

async function postWake(body: JobWakeRequest): Promise<void> {
  const origin = jobWorkerUrl()
  const secret = token()
  if (!origin || !secret) return
  log.info(
    {
      event: 'job.wake_sent',
      workspace_key: body.workspaceKey,
      job_ids: body.jobIds?.length ?? 0,
      abort: Boolean(body.abort),
    },
    'job wake sent'
  )
  let lastStatus: number | undefined
  let lastErr: unknown
  for (let attempt = 0; attempt < WAKE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${origin}/api/internal/job-wake`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
      })
      await response.body?.cancel()
      if (response.ok) return
      lastStatus = response.status
      lastErr = undefined
    } catch (err) {
      lastErr = err
      lastStatus = undefined
    }
    const backoff = WAKE_RETRY_BACKOFF_MS[attempt]
    if (backoff !== undefined) await delay(backoff)
  }
  log.warn(
    { err: lastErr, workspace_key: body.workspaceKey, status: lastStatus, attempts: WAKE_ATTEMPTS },
    'job-wake POST failed after retries; a later wake or an activity refresh that starts the loop will claim'
  )
}

function flush(workspaceKey: string): void {
  const entry = pending.get(workspaceKey)
  if (!entry) return
  pending.delete(workspaceKey)
  if (entry.timer) clearTimeout(entry.timer)
  void postWake({
    workspaceKey,
    jobIds: [...entry.jobIds],
    abort: entry.abort,
  })
}

function schedule(work: DurableWork, abort?: JobWakeAbort, immediate = false): void {
  let entry = pending.get(work.workspaceKey)
  if (!entry) {
    entry = { workspaceKey: work.workspaceKey, jobIds: new Set() }
    pending.set(work.workspaceKey, entry)
  }
  for (const id of work.jobIds) entry.jobIds.add(id)
  if (abort) entry.abort = abort
  if (immediate) {
    flush(work.workspaceKey)
    return
  }
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => flush(work.workspaceKey), COALESCE_MS)
  entry.timer.unref?.()
}

/** Abort payloads bypass debounce so a later after-commit wake cannot drop them. */
export function postJobWakeAbort(abort: JobWakeAbort): void {
  if (getProcessRole() !== 'web' || !jobWorkerUrl()) return
  const workspaceKey = getCurrentWorkspace()?.workspaceKey
  if (!workspaceKey) return
  schedule({ workspaceKey, jobIds: [] }, abort, true)
}

export function startJobWakePublisher(): void {
  if (unsubscribe) return
  if (getProcessRole() !== 'web') return
  if (!jobWorkerUrl()) {
    log.info('QUACKBACK_JOB_WORKER_URL unset — job-wake publisher idle; poll is the floor')
    return
  }
  unsubscribe = onDurableWorkCommitted((work) => schedule(work))
}

export function stopJobWakePublisher(): void {
  unsubscribe?.()
  unsubscribe = null
  for (const entry of pending.values()) {
    if (entry.timer) clearTimeout(entry.timer)
  }
  pending.clear()
}

/** Test seam. */
export function __resetJobWakePublisherForTests(): void {
  stopJobWakePublisher()
}
