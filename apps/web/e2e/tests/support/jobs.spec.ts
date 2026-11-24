/**
 * Background jobs a support customer or teammate can observe (JOB-08, JOB-13,
 * JOB-14, RT-33): the snooze wake and the SLA breach sweep. Sweeps are
 * workspace-wide, so each test backdates its own rows, sweeps at the wall
 * clock and asserts only on its own rows.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { runSweep } from '../../support/sweeps'
import {
  bodyOf,
  deliveriesOf,
  emailConversation,
  hookOp,
  hooksApi,
  openStream,
  subscribe,
  unsubscribe,
  type StreamFrame,
} from '../../support/webhooks'

type ConversationFrame = { kind?: string; conversation?: Record<string, unknown> }

function conversationFrames(frames: StreamFrame[], id: string): Record<string, unknown>[] {
  return frames
    .map((f) => f.data as ConversationFrame)
    .filter((d) => d && d.kind === 'conversation' && d.conversation?.id === id)
    .map((d) => d.conversation!)
}

const uuid = (id: string) => toUuid(id as `conversation_${string}`)

test.describe('snooze wake', () => {
  test(
    'JOB-08 RT-33 a snoozed conversation wakes when its time passes: open, timer cleared, live frames and a system status change',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      test.setTimeout(60_000)
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['conversation.status_changed'])
      const sql = supportDb()
      const streams: Array<{ close: () => void }> = []
      try {
        const id = await emailConversation(request, customerEmail, marker)
        // "Until reply" snooze: never woken by the sweep.
        const untilReply = await emailConversation(request, `reply-${customerEmail}`, `${marker}-r`)
        for (const c of [id, untilReply]) {
          const res = await api.post(`/api/v1/conversations/${c}/status`, {
            data: { status: 'snoozed' },
          })
          expect(res.status(), await res.text()).toBe(200)
        }
        // The timer fell due a second ago.
        await sql`UPDATE conversations SET snoozed_until = now() - interval '1 second'
          WHERE id = ${uuid(id)}`
        const [{ n: messagesBefore }] =
          await sql`SELECT count(*)::int AS n FROM conversation_messages WHERE conversation_id = ${uuid(id)}`

        const inbox = await openStream('scope=inbox', { person: 'admin' })
        const visitorId = (
          await sql`SELECT visitor_principal_id AS v FROM conversations WHERE id = ${uuid(id)}`
        )[0].v as string
        const { fromUuid } = await import('@quackback/ids')
        const { token } = hookOp<{ token: string }>({
          op: 'stream-token',
          principalId: fromUuid('principal', visitorId),
          scope: 'widget',
        })
        const visitor = await openStream(`conversationId=${id}`, { token })
        streams.push(inbox, visitor)
        await Promise.all([inbox.ready, visitor.ready])

        const run = await runSweep(request, 'snooze-sweep')
        expect(run.result.woken).toBeGreaterThanOrEqual(1)

        const [row] =
          await sql`SELECT status, snoozed_until FROM conversations WHERE id = ${uuid(id)}`
        expect(row.status).toBe('open')
        expect(row.snoozed_until).toBeNull()
        const [still] = await sql`SELECT status FROM conversations WHERE id = ${uuid(untilReply)}`
        expect(still.status).toBe('snoozed')

        // The inbox gets the full conversation, the visitor the stripped one.
        await expect
          .poll(() => conversationFrames(inbox.frames, id).some((c) => c.status === 'open'), {
            timeout: 10_000,
          })
          .toBe(true)
        const inboxFrame = conversationFrames(inbox.frames, id).find((c) => c.status === 'open')!
        expect(inboxFrame.snoozedUntil).toBeNull()
        expect(inboxFrame.visitorEmail).toBe(customerEmail)
        await expect
          .poll(() => conversationFrames(visitor.frames, id).some((c) => c.status === 'open'), {
            timeout: 10_000,
          })
          .toBe(true)
        const visitorFrame = conversationFrames(visitor.frames, id).find(
          (c) => c.status === 'open'
        )!
        expect(visitorFrame.visitorEmail).toBeNull()
        expect(visitorFrame.snoozedUntil).toBeNull()

        // status_changed from snoozed, by the system.
        const changes = await deliveriesOf(marker, 'conversation.status_changed', id, { count: 2 })
        const wake = changes
          .map((d) => bodyOf<Record<string, unknown>>(d).data)
          .find((d) => d.newStatus === 'open')
        expect(wake).toMatchObject({ previousStatus: 'snoozed', newStatus: 'open' })
        const actors = await sql`SELECT actor_type FROM events
          WHERE type = 'conversation.status_changed' AND payload::text LIKE ${`%${id}%`}
            AND payload ->> 'newStatus' = 'open'`
        expect(actors.map((a) => a.actor_type)).toEqual(['service'])
        // The sweep writes no system message.
        const [{ n: messagesAfter }] =
          await sql`SELECT count(*)::int AS n FROM conversation_messages WHERE conversation_id = ${uuid(id)}`
        expect(messagesAfter).toBe(messagesBefore)
      } finally {
        for (const s of streams) s.close()
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )
})

test.describe('SLA breach sweep', () => {
  test(
    'JOB-13 an overdue conversation SLA is recorded once with one clock event; a paused clock never breaches; a next-response breach names its cycle',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const sql = supportDb()
      try {
        // First response was due 9 minutes ago.
        const late = await emailConversation(request, customerEmail, marker)
        hookOp({
          op: 'sla-conversation',
          conversationId: late,
          firstResponseSecs: 60,
          appliedMinutesAgo: 10,
        })
        // Same, but snoozed first, so the clock starts paused (snoozing after
        // the overdue apply would race the app's own per-minute breach sweep).
        const paused = await emailConversation(request, `paused-${customerEmail}`, `${marker}-p`)
        const snooze = await api.post(`/api/v1/conversations/${paused}/status`, {
          data: { status: 'snoozed' },
        })
        expect(snooze.status()).toBe(200)
        hookOp({
          op: 'sla-conversation',
          conversationId: paused,
          firstResponseSecs: 60,
          appliedMinutesAgo: 10,
        })
        const [pausedRow] = await sql`SELECT sla_applied ->> 'pausedAt' AS p FROM conversations
          WHERE id = ${uuid(paused)}`
        expect(pausedRow.p).not.toBeNull()
        // A next-response cycle that fell due a minute ago (first response settled).
        const cycle = await emailConversation(request, `cycle-${customerEmail}`, `${marker}-c`)
        hookOp({
          op: 'sla-conversation',
          conversationId: cycle,
          firstResponseSecs: 600,
          nextResponseSecs: 60,
          appliedMinutesAgo: 1,
        })
        const cycleAt = new Date(Date.now() - 2 * 60_000).toISOString()
        await sql`UPDATE conversations SET sla_applied = sla_applied || ${sql.json({
          firstResponseAt: new Date(Date.now() - 3 * 60_000).toISOString(),
          nextResponseCycleAt: cycleAt,
          nextResponseDueAt: new Date(Date.now() - 60_000).toISOString(),
        })}::jsonb WHERE id = ${uuid(cycle)}`

        for (let pass = 0; pass < 2; pass++) await runSweep(request, 'sla-breach-sweep')

        const [lateRow] = await sql`SELECT sla_applied ->> 'firstResponseBreachedAt' AS b
          FROM conversations WHERE id = ${uuid(late)}`
        expect(lateRow.b).not.toBeNull()
        const lateEvents = await sql`SELECT kind, meta FROM sla_events
          WHERE conversation_id = ${uuid(late)} AND kind LIKE '%breached'`
        expect(lateEvents.map((e) => e.kind)).toEqual(['first_response_breached'])

        const [pausedAfter] = await sql`SELECT sla_applied ->> 'firstResponseBreachedAt' AS b
          FROM conversations WHERE id = ${uuid(paused)}`
        expect(pausedAfter.b).toBeNull()
        expect(
          await sql`SELECT 1 FROM sla_events
            WHERE conversation_id = ${uuid(paused)} AND kind LIKE '%breached'`
        ).toHaveLength(0)

        const cycleEvents = await sql`SELECT kind, meta FROM sla_events
          WHERE conversation_id = ${uuid(cycle)} AND kind LIKE '%breached'`
        expect(cycleEvents.map((e) => e.kind)).toEqual(['next_response_breached'])
        expect((cycleEvents[0].meta as { cycleAt?: string }).cycleAt).toBe(cycleAt)
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'JOB-14 an overdue ticket time-to-resolve is recorded once by the sweep',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const sql = supportDb()
      try {
        const res = await api.post('/api/v1/tickets', {
          data: {
            title: `TTR ${marker}`,
            description: 'Overdue',
            requesterPrincipalId: people.people.customer.principalId,
          },
        })
        expect(res.status(), await res.text()).toBe(201)
        const ticketId = ((await res.json()) as { data: { id: string } }).data.id
        hookOp({ op: 'sla-ticket', ticketId, timeToResolveSecs: 60, appliedMinutesAgo: 10 })
        const tid = toUuid(ticketId as `ticket_${string}`)

        await runSweep(request, 'sla-breach-sweep')
        const [first] = await sql`SELECT sla_applied ->> 'resolutionBreachedAt' AS b
          FROM tickets WHERE id = ${tid}`
        expect(first.b).not.toBeNull()
        await runSweep(request, 'sla-breach-sweep')
        const [second] = await sql`SELECT sla_applied ->> 'resolutionBreachedAt' AS b
          FROM tickets WHERE id = ${tid}`
        expect(second.b).toBe(first.b)
        const breaches = await sql`SELECT kind FROM sla_events
          WHERE ticket_id = ${tid} AND kind LIKE '%breached'`
        expect(breaches.map((e) => e.kind)).toEqual(['time_to_resolve_breached'])
      } finally {
        await api.dispose()
      }
    }
  )
})
