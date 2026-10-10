/** Process-local in-flight Slack turns. Abort from the HTTP ack so Stop
 *  does not wait behind the serial `slack-hook` queue. */
const inflight = new Map<string, AbortController>()

export function slackInflightTurnKey(team: string, channel: string, thread: string): string {
  return `${team}\0${channel}\0${thread}`
}

export function beginSlackTurn(team: string, channel: string, thread: string): AbortController {
  const key = slackInflightTurnKey(team, channel, thread)
  inflight.get(key)?.abort()
  const controller = new AbortController()
  inflight.set(key, controller)
  return controller
}

export function abortSlackTurn(team: string, channel: string, thread: string): boolean {
  const controller = inflight.get(slackInflightTurnKey(team, channel, thread))
  if (!controller || controller.signal.aborted) return false
  controller.abort()
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
