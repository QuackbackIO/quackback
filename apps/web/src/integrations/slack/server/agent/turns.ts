import { getProcessRole } from '@/lib/server/process-role'

/** Process-local in-flight Slack turns. Abort from the HTTP ack so Stop
 *  does not wait behind the serial `slack-hook` queue. */
const inflight = new Map<string, AbortController>()
/** Stop that arrived before `beginSlackTurn` (preflight). Dropped after this. */
const pendingAbort = new Map<string, number>()
const PENDING_ABORT_TTL_MS = 120_000

export function slackInflightTurnKey(team: string, channel: string, thread: string): string {
  return `${team}\0${channel}\0${thread}`
}

function sweepPendingAborts(now = Date.now()): void {
  for (const [key, at] of pendingAbort) {
    if (now - at >= PENDING_ABORT_TTL_MS) pendingAbort.delete(key)
  }
}

export function beginSlackTurn(team: string, channel: string, thread: string): AbortController {
  const key = slackInflightTurnKey(team, channel, thread)
  inflight.get(key)?.abort()
  const controller = new AbortController()
  inflight.set(key, controller)
  sweepPendingAborts()
  const at = pendingAbort.get(key)
  if (at !== undefined) {
    pendingAbort.delete(key)
    if (Date.now() - at < PENDING_ABORT_TTL_MS) controller.abort()
  }
  return controller
}

export function abortSlackTurn(team: string, channel: string, thread: string): boolean {
  const key = slackInflightTurnKey(team, channel, thread)
  const controller = inflight.get(key)
  if (controller && !controller.signal.aborted) {
    controller.abort()
    return true
  }
  if (controller?.signal.aborted) return false
  sweepPendingAborts()
  // Cloud web has no in-flight turns; postJobWakeAbort already forwards Stop.
  if (getProcessRole() === 'web') return false
  pendingAbort.set(key, Date.now())
  return true
}

export function endSlackTurn(
  team: string,
  channel: string,
  thread: string,
  controller: AbortController
): void {
  const key = slackInflightTurnKey(team, channel, thread)
  if (inflight.get(key) === controller) inflight.delete(key)
}

export function abortSlackTurnFromPayload(payload: {
  team_id?: unknown
  team?: { id?: unknown }
  event?: { type?: unknown; channel?: unknown; thread_ts?: unknown }
}): boolean {
  const event = payload.event
  if (event?.type !== 'agent_session_stopped') return false
  const team = payload.team_id ?? payload.team?.id
  const channel = event.channel
  const thread = event.thread_ts
  if (typeof team !== 'string' || typeof channel !== 'string' || typeof thread !== 'string')
    return false
  return abortSlackTurn(team, channel, thread)
}
