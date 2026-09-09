import { createHash } from 'node:crypto'
import { verifySlackSignature } from './verify'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { shouldEnqueueSlackEvent } from './agent/addressing'
import { abortSlackTurnFromPayload } from './agent/turns'

export function parseSlackPayload(kind: string, raw: string): Record<string, any> {
  if (kind === 'events') return JSON.parse(raw)
  const form = new URLSearchParams(raw)
  return kind === 'commands' ? Object.fromEntries(form) : JSON.parse(form.get('payload') ?? '{}')
}
export const slackAppHooks: NonNullable<IntegrationDefinition['appHooks']> = {
  kinds: ['events', 'interactions', 'commands', 'options'],
  verify: ({ headers, rawBody, credentials, verifiedAt }) =>
    verifySlackSignature(
      rawBody,
      headers.get('x-slack-request-timestamp'),
      headers.get('x-slack-signature'),
      credentials.signingSecret,
      verifiedAt
    ) === true,
  deliveryId(kind, rawBody) {
    const body = parseSlackPayload(kind, rawBody)
    if (body.type === 'url_verification') return null
    return (
      (kind === 'events' ? body.event_id : body.trigger_id) ??
      createHash('sha256').update(rawBody).digest('hex')
    )
  },
  async handle(kind, rawBody, _contentType, executor) {
    const payload = parseSlackPayload(kind, rawBody)
    if (kind === 'events' && payload.type === 'url_verification')
      return Response.json({ challenge: payload.challenge })
    if (kind === 'options') return Response.json({ options: [] })
    const event = payload.event
    // Abort before enqueue: slack-hook is serial, so a Stop job would otherwise
    // wait until the in-flight turn finished.
    if (kind === 'events') {
      abortSlackTurnFromPayload(payload)
      if (event?.type === 'agent_session_stopped') {
        const team = payload.team_id ?? payload.team?.id
        const channel = event.channel
        const thread = event.thread_ts
        if (typeof team === 'string' && typeof channel === 'string' && typeof thread === 'string') {
          const { postJobWakeAbort } = await import('@/lib/server/jobs/wake')
          postJobWakeAbort({ team, channel, thread })
        }
      }
    }
    if (kind === 'events' && !shouldEnqueueSlackEvent(event))
      return new Response(null, { status: 200 })
    // Transport payloads are encrypted, short-lived, and never written to
    // assistant logs. Full thread context is fetched in memory by the worker.
    await enqueueJob({
      queue: 'slack-hook',
      payload: { kind, encryptedPayload: encryptSecrets(payload) },
      dedupeKey: this.deliveryId(kind, rawBody, _contentType),
      maxAttempts: 3,
      executor,
    })
    return kind === 'commands'
      ? Response.json({ response_type: 'ephemeral', text: 'Working on it…' })
      : new Response(null, { status: 200 })
  },
}
