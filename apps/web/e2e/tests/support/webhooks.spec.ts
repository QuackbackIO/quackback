/**
 * Outgoing webhooks for support events (journeys API-69 to API-92), delivered
 * to the local https sink. Each test subscribes its own webhook on a sink
 * channel named by its marker and filters deliveries by its own conversation
 * or ticket id: the sink and the database are shared by every worker.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { sink } from '../../support/webhook-sink-client'
import { conversationReplyAddress, sendInboundEmail } from '../../support/inbound-email'
import { runSweep } from '../../support/sweeps'
import {
  bodyOf,
  createWorkflow,
  deliveriesOf,
  emailConversation,
  expectSigned,
  hookOp,
  hooksApi,
  subscribe,
  unsubscribe,
  type Hook,
} from '../../support/webhooks'

type Json = Record<string, unknown>

const CONVERSATION_REF_KEYS = ['assignedTeamId', 'channel', 'id', 'priority', 'status']
const TICKET_REF_KEYS = [
  'assignedPrincipalId',
  'assignedTeamId',
  'id',
  'number',
  'priority',
  'ticketTypeId',
  'type',
]

/** Outbox rows of `type` that name `entityId` (the source every hook job is made from). */
async function outboxRows(type: string, entityId: string): Promise<Array<{ actor_type: string }>> {
  const sql = supportDb()
  return (await sql`SELECT actor_type FROM events
    WHERE type = ${type} AND payload::text LIKE ${`%${entityId}%`}`) as never
}

test.describe('webhook subscriptions', () => {
  test(
    'API-69 a webhook subscribed to support events returns its secret; bad URLs and events are refused',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const created = await api.post('/api/v1/webhooks', {
        data: { url: sink.url(marker), events: ['message.created', 'ticket.created'] },
      })
      expect(created.status(), await created.text()).toBe(201)
      const { data } = (await created.json()) as { data: Hook & { events: string[] } }
      expect(data.secret).toEqual(expect.any(String))
      expect(data.secret.length).toBeGreaterThan(16)
      expect(data.events.sort()).toEqual(['message.created', 'ticket.created'])

      for (const url of [
        sink.url(marker).replace('https://', 'http://'),
        'https://10.1.2.3/hook',
        'https://192.168.1.10/hook',
        'https://localhost/hook',
      ]) {
        const refused = await api.post('/api/v1/webhooks', {
          data: { url, events: ['message.created'] },
        })
        expect(refused.status(), url).toBe(400)
        const { error } = (await refused.json()) as { error: { code: string; message: string } }
        expect(error.code, url).toBe('VALIDATION_ERROR')
        expect(error.message, url).toBe(
          'Invalid webhook URL: must be HTTPS and cannot target private networks'
        )
      }

      const empty = await api.post('/api/v1/webhooks', {
        data: { url: sink.url(marker), events: [] },
      })
      expect(empty.status()).toBe(400)
      expect(JSON.stringify(await empty.json())).toContain('At least one event is required')

      const unknown = await api.post('/api/v1/webhooks', {
        data: { url: sink.url(marker), events: ['conversation.exploded'] },
      })
      expect(unknown.status()).toBe(400)
      expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST')

      await unsubscribe(api, data)
      await api.dispose()
    }
  )

  test(
    'API-70 the signature verifies and the event id is stable across a retried delivery',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['conversation.created'])
      // The receiver fails the first attempt; the fast retry (about 1 s later) succeeds.
      await sink.respondWith(marker, 500)
      try {
        const conversationId = await emailConversation(request, customerEmail, marker)
        const [first] = await deliveriesOf(marker, 'conversation.created', conversationId)
        expect(first.status).toBe(500)
        await sink.respondWith(marker, null)
        const all = await deliveriesOf(marker, 'conversation.created', conversationId, {
          count: 2,
          timeoutMs: 30_000,
        })
        expect(all[1].status).toBe(200)
        for (const d of all) expectSigned(d, hook.secret)
        // Receivers deduplicate on the body id: the same event both times.
        expect(bodyOf(all[1]).id).toBe(bodyOf(all[0]).id)
        expect(bodyOf(all[0]).id).toMatch(/^evt_/)
        // A wrong secret does not verify.
        expect(() => expectSigned(all[1], `${hook.secret}x`)).toThrow()
      } finally {
        await sink.respondWith(marker, null)
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-73 a hook pointed at the local https sink receives a signed delivery with the documented headers',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      // The test allowance covers only the sink host: other loopback and
      // private https URLs stay refused.
      for (const url of ['https://127.0.0.1:4011/hooks/x', 'https://172.16.0.5/hooks/x']) {
        const refused = await api.post('/api/v1/webhooks', {
          data: { url, events: ['conversation.created'] },
        })
        expect(refused.status(), url).toBe(400)
      }
      const hook = await subscribe(api, marker, ['conversation.created'])
      const conversationId = await emailConversation(request, customerEmail, marker)
      const [d] = await deliveriesOf(marker, 'conversation.created', conversationId)
      expect(d.method).toBe('POST')
      expect(d.headers['content-type']).toContain('application/json')
      expect(d.headers['user-agent']).toBe('Quackback-Webhook/1.0 (+https://quackback.io)')
      expect(d.headers['x-quackback-event']).toBe('conversation.created')
      expectSigned(d, hook.secret)
      expect(Object.keys(bodyOf(d)).sort()).toEqual(['createdAt', 'data', 'id', 'type'])
      await unsubscribe(api, hook)
      await api.dispose()
    }
  )
  test(
    'API-69 a deleted webhook frees its place under the 25-webhook cap',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const sql = supportDb()
      const creator = toUuid(people.people.admin.principalId as `principal_${string}`)
      const deletedUrl = sink.url(`${marker}-deleted`)
      try {
        // 25 webhooks that were created and then deleted.
        for (let i = 0; i < 25; i++) {
          await sql`INSERT INTO webhooks (id, created_by_id, url, secret, events, deleted_at)
            VALUES (gen_random_uuid(), ${creator}, ${deletedUrl}, 'x', ${['message.created']}, now())`
        }
        const res = await api.post('/api/v1/webhooks', {
          data: { url: sink.url(marker), events: ['message.created'] },
        })
        expect(res.status(), await res.text()).toBe(201)
        await unsubscribe(api, ((await res.json()) as { data: Hook }).data)
      } finally {
        await sql`DELETE FROM webhooks WHERE url = ${deletedUrl}`
        await api.dispose()
      }
    }
  )
})

test.describe('conversation events', () => {
  test(
    'API-74 conversation.created carries the conversation shape; an anonymous visitor has a null email',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request, browser }) => {
      test.setTimeout(60_000)
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['conversation.created'])
      try {
        // An email sender: the visitor email is the real address.
        const emailId = await emailConversation(request, customerEmail, marker)
        const [d] = await deliveriesOf(marker, 'conversation.created', emailId)
        const { data, type } = bodyOf<{ conversation: Json }>(d)
        expect(type).toBe('conversation.created')
        expect(Object.keys(data.conversation).sort()).toEqual(
          [
            'assignedAgentPrincipalId',
            'assignedTeamId',
            'channel',
            'createdAt',
            'id',
            'lastMessageAt',
            'priority',
            'resolvedAt',
            'status',
            'subject',
            'visitorEmail',
            'visitorPrincipalId',
          ].sort()
        )
        expect(data.conversation).toMatchObject({
          id: emailId,
          status: 'open',
          channel: 'email',
          visitorEmail: customerEmail,
          resolvedAt: null,
        })

        // An anonymous widget visitor: no email reaches the payload.
        const context = await browser.newContext()
        const page = await context.newPage()
        await page.goto('/widget')
        await page.getByRole('button', { name: 'Messages', exact: true }).click()
        await page.getByRole('button', { name: /Ask a question/ }).click()
        const composer = page.locator('.ProseMirror[contenteditable="true"]')
        await composer.click()
        await composer.fill(`Anonymous ${marker}`)
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
        await composer.press('Enter')
        const sql = supportDb()
        const row = await pollFor(
          'the widget conversation',
          async () =>
            (
              await sql`SELECT c.id FROM conversation_messages m
                JOIN conversations c ON c.id = m.conversation_id
                WHERE m.content LIKE ${`%Anonymous ${marker}%`} LIMIT 1`
            )[0] ?? null,
          { timeoutMs: 15_000 }
        )
        await context.close()
        const { fromUuid } = await import('@quackback/ids')
        const anonId = fromUuid('conversation', row.id as string)
        const [anon] = await deliveriesOf(marker, 'conversation.created', anonId)
        expect(bodyOf<{ conversation: Json }>(anon).data.conversation).toMatchObject({
          id: anonId,
          channel: 'messenger',
          visitorEmail: null,
        })
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-75 conversation.status_changed carries the ref and previous and new status (open, snoozed, closed)',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['conversation.status_changed'])
      try {
        const id = await emailConversation(request, customerEmail, marker)
        const steps: Array<[string, string]> = [
          ['open', 'closed'],
          ['closed', 'open'],
          ['open', 'snoozed'],
        ]
        for (const [, next] of steps) {
          const res = await api.post(`/api/v1/conversations/${id}/status`, {
            data: { status: next },
          })
          expect(res.status(), await res.text()).toBe(200)
          // Wait for each before the next so the order is the one we made.
          await sink.waitForDeliveries(marker, {
            where: (d) => d.body.includes(id) && d.body.includes(`"newStatus":"${next}"`),
          })
        }
        const all = await deliveriesOf(marker, 'conversation.status_changed', id, { count: 3 })
        const seen = all.map((d) => {
          const { data } = bodyOf<{
            conversation: Json
            previousStatus: string
            newStatus: string
          }>(d)
          expect(Object.keys(data.conversation).sort()).toEqual(CONVERSATION_REF_KEYS)
          expect(data.conversation.id).toBe(id)
          return [data.previousStatus, data.newStatus]
        })
        expect(seen).toEqual(steps)
        for (const [prev, next] of seen) {
          expect(['open', 'snoozed', 'closed']).toContain(prev)
          expect(['open', 'snoozed', 'closed']).toContain(next)
        }
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-76 conversation.assigned carries assignee before and after; a workspace-key reply never fires it',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['conversation.assigned', 'message.created'])
      try {
        const id = await emailConversation(request, customerEmail, marker)
        // An API key reply first: it is a service reply and claims nothing.
        const reply = await api.post(`/api/v1/conversations/${id}/reply`, {
          data: { content: `Key reply ${marker}` },
        })
        expect(reply.status(), await reply.text()).toBe(201)
        await sink.waitForDeliveries(marker, {
          where: (d) => d.body.includes(`Key reply ${marker}`),
        })
        expect(await outboxRows('conversation.assigned', id)).toHaveLength(0)

        const agentB = people.people.agentB.principalId
        const admin = people.people.admin.principalId
        for (const assignee of [agentB, admin]) {
          const res = await api.post(`/api/v1/conversations/${id}/assign`, {
            data: { assigneePrincipalId: assignee },
          })
          expect(res.status(), await res.text()).toBe(200)
          await sink.waitForDeliveries(marker, {
            where: (d) =>
              d.body.includes(id) && d.body.includes(`"assignedAgentPrincipalId":"${assignee}"`),
          })
        }
        const all = await deliveriesOf(marker, 'conversation.assigned', id, { count: 2 })
        const pairs = all.map((d) => {
          const { data } = bodyOf<Json & { conversation: Json }>(d)
          expect(Object.keys(data.conversation).sort()).toEqual(CONVERSATION_REF_KEYS)
          return [data.previousAgentPrincipalId, data.assignedAgentPrincipalId]
        })
        expect(pairs).toEqual([
          [null, agentB],
          [agentB, admin],
        ])
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-77 conversation.priority_changed carries previous and new priority',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['conversation.priority_changed'])
      try {
        const id = await emailConversation(request, customerEmail, marker)
        const res = await api.post(`/api/v1/conversations/${id}/priority`, {
          data: { priority: 'urgent' },
        })
        expect(res.status(), await res.text()).toBe(200)
        const [d] = await deliveriesOf(marker, 'conversation.priority_changed', id)
        const { data } = bodyOf<Json & { conversation: Json }>(d)
        expect(data).toMatchObject({ previousPriority: 'none', newPriority: 'urgent' })
        expect(data.conversation).toMatchObject({ id, priority: 'urgent' })
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-78 conversation.attribute_changed carries key, value and source',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['conversation.attribute_changed'])
      const key = `e2e_${marker.replace(/[^a-z0-9]/g, '_')}`.slice(0, 60)
      try {
        const id = await emailConversation(request, customerEmail, marker)
        hookOp({ op: 'attribute', conversationId: id, key, value: `Value ${marker}` })
        const [d] = await deliveriesOf(marker, 'conversation.attribute_changed', id)
        const { data } = bodyOf<Json & { conversation: Json }>(d)
        expect(data).toMatchObject({
          conversationId: id,
          key,
          value: `Value ${marker}`,
          source: 'teammate',
        })
        expect(data.conversation).toMatchObject({ id })
      } finally {
        hookOp({ op: 'archive-attribute', key })
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-79 csat_submitted fires once with rating and comment; a later comment fires csat_comment_added',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, [
        'conversation.csat_submitted',
        'conversation.csat_comment_added',
      ])
      try {
        const id = await emailConversation(request, customerEmail, marker)
        // The widget posts the rating, then the comment.
        hookOp({ op: 'csat', conversationId: id, rating: 4 })
        hookOp({ op: 'csat', conversationId: id, rating: 4, comment: `Thanks ${marker}` })
        const [comment] = await deliveriesOf(marker, 'conversation.csat_comment_added', id)
        expect(bodyOf<Json>(comment).data).toMatchObject({
          rating: 4,
          comment: `Thanks ${marker}`,
          submittedAt: expect.any(String),
          conversation: expect.objectContaining({ id }),
        })
        const [submitted] = await deliveriesOf(marker, 'conversation.csat_submitted', id)
        expect(bodyOf<Json>(submitted).data).toMatchObject({
          rating: 4,
          comment: null,
          submittedAt: expect.any(String),
          conversation: expect.objectContaining({ id }),
        })
        // Once per survey: a second rating writes no second submitted event.
        hookOp({ op: 'csat', conversationId: id, rating: 2 })
        expect(await outboxRows('conversation.csat_submitted', id)).toHaveLength(1)
        expect(await outboxRows('conversation.csat_comment_added', id)).toHaveLength(1)
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-80 conversation.note_mentioned carries the conversation id and the mentioned teammate gets a bell',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['conversation.note_mentioned'])
      try {
        const id = await emailConversation(request, customerEmail, marker)
        hookOp({
          op: 'note-mention',
          conversationId: id,
          authorEmail: people.people.admin.email,
          mentionEmail: people.people.agentB.email,
          text: `please look ${marker}`,
        })
        const [d] = await deliveriesOf(marker, 'conversation.note_mentioned', id)
        expect(bodyOf<Json>(d).data).toMatchObject({ conversationId: id })
        const sql = supportDb()
        await expect
          .poll(
            async () =>
              (
                await sql`SELECT count(*)::int AS n FROM in_app_notifications
                  WHERE principal_id = ${toUuid(people.people.agentB.principalId as `principal_${string}`)}
                    AND type = 'chat_mention' AND metadata::text LIKE ${`%${id}%`}`
              )[0].n,
            { timeout: 15_000 }
          )
          .toBe(1)
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-81 customer_unresponsive and teammate_unresponsive arrive with workflow id, silence minutes and sinceAt',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      test.setTimeout(90_000)
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, [
        'conversation.customer_unresponsive',
        'conversation.teammate_unresponsive',
      ])
      // Never-matching graphs: the events fire, no run starts.
      const graph = {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'c',
            type: 'condition',
            condition: { field: 'message.body', op: 'contains', value: marker },
          },
          { id: 'a', type: 'action', action: { type: 'set_priority', priority: 'low' } },
        ],
        edges: [
          { from: 't', to: 'c' },
          { from: 'c', to: 'a' },
        ],
      }
      const flows: Array<{ id: string; cleanup: () => void }> = []
      try {
        for (const triggerType of [
          'conversation.customer_unresponsive',
          'conversation.teammate_unresponsive',
        ]) {
          flows.push(
            await createWorkflow({
              name: `Unresponsive ${triggerType} ${marker}`,
              class: 'background',
              triggerType,
              triggerSettings: { inactivityMinutes: 5 },
              graph,
            })
          )
        }
        const [customerFlow, teammateFlow] = flows
        // Teammate silence: the customer wrote 6 minutes ago, nobody answered.
        const waiting = await emailConversation(request, customerEmail, marker)
        // Customer silence: a teammate answered 6 minutes ago, the customer went quiet.
        const quiet = await emailConversation(request, `quiet-${customerEmail}`, `${marker}-q`)
        const reply = await api.post(`/api/v1/conversations/${quiet}/reply`, {
          data: { content: `Answer ${marker}` },
        })
        expect(reply.status(), await reply.text()).toBe(201)
        const sql = supportDb()
        await sql`UPDATE conversations SET waiting_since = now() - interval '6 minutes',
          last_message_at = now() - interval '6 minutes'
          WHERE id = ${toUuid(waiting as `conversation_${string}`)}`
        await sql`UPDATE conversations SET waiting_since = NULL,
          last_message_at = now() - interval '6 minutes'
          WHERE id = ${toUuid(quiet as `conversation_${string}`)}`
        await runSweep(request, 'workflow-sweep')

        const [t] = await deliveriesOf(marker, 'conversation.teammate_unresponsive', waiting)
        expect(bodyOf<Json>(t).data).toMatchObject({
          conversationId: waiting,
          conversation: expect.objectContaining({ id: waiting }),
          workflowId: teammateFlow.id,
          // Minutes actually silent (backdated 6), at or past the workflow's 5.
          silenceMinutes: 6,
          sinceAt: expect.any(String),
        })
        const [c] = await deliveriesOf(marker, 'conversation.customer_unresponsive', quiet)
        expect(bodyOf<Json>(c).data).toMatchObject({
          conversationId: quiet,
          workflowId: customerFlow.id,
          silenceMinutes: 6,
          sinceAt: expect.any(String),
        })
        // A synthetic event with a system actor.
        const rows = await outboxRows('conversation.teammate_unresponsive', waiting)
        expect(rows.map((r) => r.actor_type)).not.toContain('user')
      } finally {
        for (const f of flows) f.cleanup()
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-92 sla.approaching_breach and sla.breached reach the sink with clock and dueAt',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      test.setTimeout(90_000)
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['sla.approaching_breach', 'sla.breached'])
      const flows: Array<{ id: string; cleanup: () => void }> = []
      try {
        // Live workflows on both triggers: the events still reach the sink
        // once each. Never-matching graphs keep runs out.
        for (const triggerType of ['sla.approaching_breach', 'sla.breached']) {
          flows.push(
            await createWorkflow({
              name: `SLA ${triggerType} ${marker}`,
              class: 'background',
              triggerType,
              triggerSettings:
                triggerType === 'sla.approaching_breach' ? { breachLeadMinutes: 30 } : {},
              graph: {
                nodes: [
                  { id: 't', type: 'trigger' },
                  {
                    id: 'c',
                    type: 'condition',
                    condition: { field: 'message.body', op: 'contains', value: marker },
                  },
                  { id: 'a', type: 'action', action: { type: 'set_priority', priority: 'low' } },
                ],
                edges: [
                  { from: 't', to: 'c' },
                  { from: 'c', to: 'a' },
                ],
              },
            })
          )
        }
        // First response due in 10 minutes: inside the 30-minute lead.
        const near = await emailConversation(request, customerEmail, marker)
        hookOp({
          op: 'sla-conversation',
          conversationId: near,
          firstResponseSecs: 600,
          appliedMinutesAgo: 0,
        })
        // First response was due 50 minutes ago.
        const late = await emailConversation(request, `late-${customerEmail}`, `${marker}-l`)
        hookOp({
          op: 'sla-conversation',
          conversationId: late,
          firstResponseSecs: 600,
          appliedMinutesAgo: 60,
        })
        await runSweep(request, 'workflow-sweep')

        const [warn] = await deliveriesOf(marker, 'sla.approaching_breach', near)
        expect(bodyOf<Json>(warn).data).toMatchObject({
          conversationId: near,
          conversation: expect.objectContaining({ id: near }),
          clock: 'first_response',
          dueAt: expect.any(String),
        })
        const [breach] = await deliveriesOf(marker, 'sla.breached', late)
        expect(bodyOf<Json>(breach).data).toMatchObject({
          conversationId: late,
          clock: 'first_response',
          dueAt: expect.any(String),
        })
        expect(bodyOf<Json>(breach).data).not.toHaveProperty('ticketId')
      } finally {
        for (const f of flows) f.cleanup()
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )
  test(
    'API-92 sla.breached is delivered with no live SLA workflow',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['sla.breached'])
      try {
        const late = await emailConversation(request, customerEmail, marker)
        hookOp({
          op: 'sla-conversation',
          conversationId: late,
          firstResponseSecs: 60,
          appliedMinutesAgo: 10,
        })
        await runSweep(request, 'sla-breach-sweep')
        await runSweep(request, 'workflow-sweep')
        const [breach] = await deliveriesOf(marker, 'sla.breached', late)
        expect(bodyOf<Json>(breach).data).toMatchObject({
          conversationId: late,
          clock: 'first_response',
        })
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )
})

test.describe('message events', () => {
  test(
    'API-82 message.created: shape, isFirstMessage only on the first visitor message, authorName as the thread shows it',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['message.created', 'message.note_created'])
      try {
        const id = await emailConversation(request, customerEmail, marker, `First ${marker}`)
        const [first] = await sink.waitForDeliveries(marker, {
          where: (d) => d.body.includes(`First ${marker}`),
        })
        const firstBody = bodyOf<{ message: Json; conversation: Json; isFirstMessage: boolean }>(
          first
        )
        expect(firstBody.type).toBe('message.created')
        expect(Object.keys(firstBody.data.message).sort()).toEqual(
          [
            'authorEmail',
            'authorName',
            'authorPrincipalId',
            'blockReplyKind',
            'content',
            'conversationId',
            'createdAt',
            'id',
            'senderType',
          ].sort()
        )
        expect(firstBody.data.message).toMatchObject({
          conversationId: id,
          senderType: 'visitor',
          content: `First ${marker}`,
          blockReplyKind: null,
        })
        expect(Object.keys(firstBody.data.conversation).sort()).toEqual(CONVERSATION_REF_KEYS)
        expect(firstBody.data.isFirstMessage).toBe(true)

        // A second customer message is not the first.
        const second = await sendInboundEmail(request, {
          from: customerEmail,
          to: conversationReplyAddress(id),
          subject: `Re: Help ${marker}`,
          text: `Second ${marker}`,
          messageId: `<${marker}-second@customers.example>`,
        })
        expect(second.status()).toBe(200)
        const [secondD] = await sink.waitForDeliveries(marker, {
          where: (d) => d.body.includes(`Second ${marker}`),
        })
        expect(bodyOf<Json>(secondD).data.isFirstMessage).toBe(false)

        // A reply through the admin's personal key reads as the admin.
        const reply = await api.post(`/api/v1/conversations/${id}/reply`, {
          data: { content: `Agent ${marker}` },
        })
        expect(reply.status(), await reply.text()).toBe(201)
        const [agentD] = await sink.waitForDeliveries(marker, {
          where: (d) => d.body.includes(`Agent ${marker}`),
        })
        const agentBody = bodyOf<{ message: Json; isFirstMessage: boolean }>(agentD)
        expect(agentBody.type).toBe('message.created')
        expect(agentBody.data.message).toMatchObject({
          senderType: 'agent',
          authorName: people.people.admin.displayName,
        })
        expect(agentBody.data.isFirstMessage).toBe(false)

        // A note is message.note_created, never message.created.
        const note = await api.post(`/api/v1/conversations/${id}/note`, {
          data: { content: `Note ${marker}` },
        })
        expect(note.status(), await note.text()).toBe(201)
        const [noteD] = await sink.waitForDeliveries(marker, {
          where: (d) => d.body.includes(`Note ${marker}`),
        })
        expect(noteD.headers['x-quackback-event']).toBe('message.note_created')
        const created = await outboxRows('message.created', id)
        expect(created).toHaveLength(3)
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-83 message.note_created has no isFirstMessage, shows the account name and carries blockReplyKind',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['message.note_created'])
      try {
        const id = await emailConversation(request, customerEmail, marker)
        const note = await api.post(`/api/v1/conversations/${id}/note`, {
          data: { content: `Note ${marker}` },
        })
        expect(note.status(), await note.text()).toBe(201)
        const [d] = await deliveriesOf(marker, 'message.note_created', id)
        const { data } = bodyOf<{ message: Json; conversation: Json }>(d)
        expect(data).not.toHaveProperty('isFirstMessage')
        expect(data.message).toMatchObject({
          conversationId: id,
          content: `Note ${marker}`,
          authorName: people.people.admin.displayName,
          blockReplyKind: null,
        })
        expect(data.conversation).toMatchObject({ id })
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-84 message.deleted fires for a public message and not for a note',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['message.deleted'])
      try {
        const id = await emailConversation(request, customerEmail, marker)
        const reply = await api.post(`/api/v1/conversations/${id}/reply`, {
          data: { content: `Delete me ${marker}` },
        })
        const replyId = ((await reply.json()) as { data: { id: string } }).data.id
        const note = await api.post(`/api/v1/conversations/${id}/note`, {
          data: { content: `Delete note ${marker}` },
        })
        const noteId = ((await note.json()) as { data: { id: string } }).data.id
        hookOp({ op: 'delete', messageId: noteId, actorEmail: people.people.admin.email })
        hookOp({ op: 'delete', messageId: replyId, actorEmail: people.people.admin.email })
        const [d] = await deliveriesOf(marker, 'message.deleted', replyId)
        const { data } = bodyOf<{ message: Json; conversation: Json }>(d)
        expect(data.message).toEqual({ id: replyId, conversationId: id })
        expect(data.conversation).toMatchObject({ id })
        expect(await outboxRows('message.deleted', noteId)).toHaveLength(0)
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-85 message.updated carries editedAt and blockReplyKind and does not fire for a note edit',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['message.updated'])
      try {
        const id = await emailConversation(request, customerEmail, marker)
        // Edits are the author's: the admin writes both through the service.
        const { messageId: replyId } = hookOp<{ messageId: string }>({
          op: 'agent-reply',
          conversationId: id,
          authorEmail: people.people.admin.email,
          text: `Before ${marker}`,
        })
        // A note by the same author, edited by them too: no message.updated.
        const { messageId: noteId } = hookOp<{ messageId: string }>({
          op: 'note-mention',
          conversationId: id,
          authorEmail: people.people.admin.email,
          mentionEmail: people.people.admin.email,
          text: `Note before ${marker}`,
        })
        hookOp({
          op: 'edit',
          messageId: noteId,
          authorEmail: people.people.admin.email,
          text: `Note after ${marker}`,
        })
        hookOp({
          op: 'edit',
          messageId: replyId,
          authorEmail: people.people.admin.email,
          text: `After ${marker}`,
        })
        const [d] = await deliveriesOf(marker, 'message.updated', replyId)
        const { data } = bodyOf<{ message: Json; conversation: Json; editedAt: string }>(d)
        expect(data.message).toMatchObject({
          id: replyId,
          content: `After ${marker}`,
          blockReplyKind: null,
        })
        expect(data.editedAt).toEqual(expect.any(String))
        expect(data.conversation).toMatchObject({ id })
        const sql = supportDb()
        const [edited] = await sql`SELECT content FROM conversation_messages
          WHERE id = ${toUuid(noteId as `conversation_msg_${string}`)}`
        expect(edited.content).toContain(`Note after ${marker}`)
        expect(await outboxRows('message.updated', noteId)).toHaveLength(0)
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )
})

test.describe('ticket events', () => {
  async function createCustomerTicket(
    api: import('@playwright/test').APIRequestContext,
    requester: string,
    title: string
  ): Promise<string> {
    const res = await api.post('/api/v1/tickets', {
      data: { title, description: `About ${title}`, requesterPrincipalId: requester },
    })
    expect(res.status(), await res.text()).toBe(201)
    return ((await res.json()) as { data: { id: string } }).data.id
  }

  test(
    'API-86 ticket.created arrives with the documented ticket shape',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['ticket.created'])
      try {
        const id = await createCustomerTicket(
          api,
          people.people.customer.principalId,
          `Ticket ${marker}`
        )
        const [d] = await deliveriesOf(marker, 'ticket.created', id)
        expectSigned(d, hook.secret)
        const { data } = bodyOf<{ ticket: Json }>(d)
        expect(Object.keys(data.ticket).sort()).toEqual(
          [
            ...TICKET_REF_KEYS,
            'companyId',
            'createdAt',
            'requesterPrincipalId',
            'resolvedAt',
            'sla',
            'stage',
            'status',
            'title',
            'updatedAt',
          ].sort()
        )
        expect(data.ticket).toMatchObject({
          id,
          type: 'customer',
          title: `Ticket ${marker}`,
          status: 'open',
          requesterPrincipalId: people.people.customer.principalId,
          resolvedAt: null,
        })
        expect(data.ticket.number).toEqual(expect.any(Number))
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-87 ticket.status_changed carries category statuses and stage',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['ticket.status_changed'])
      try {
        const id = await createCustomerTicket(
          api,
          people.people.customer.principalId,
          `Status ${marker}`
        )
        const statuses = (await (await api.get('/api/v1/ticket-statuses')).json()) as {
          data: Array<{ id: string; category: string }>
        }
        const closed = statuses.data.find((s) => s.category === 'closed')!
        const res = await api.post(`/api/v1/tickets/${id}/status`, {
          data: { statusId: closed.id },
        })
        expect(res.status(), await res.text()).toBe(200)
        const [d] = await deliveriesOf(marker, 'ticket.status_changed', id)
        const { data } = bodyOf<Json & { ticket: Json }>(d)
        expect(data).toMatchObject({
          previousStatus: 'open',
          newStatus: 'closed',
          requesterPrincipalId: people.people.customer.principalId,
        })
        expect(data).toHaveProperty('stage')
        expect(data.ticket).toMatchObject({ id })
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-88 ticket.assigned carries person and team before and after, and the assignee gets a bell',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['ticket.assigned'])
      try {
        const id = await createCustomerTicket(
          api,
          people.people.customer.principalId,
          `Assign ${marker}`
        )
        const agentB = people.people.agentB.principalId
        const res = await api.post(`/api/v1/tickets/${id}/assign`, {
          data: { assigneePrincipalId: agentB, assigneeTeamId: people.teams.support },
        })
        expect(res.status(), await res.text()).toBe(200)
        const [d] = await deliveriesOf(marker, 'ticket.assigned', id)
        expect(bodyOf<Json>(d).data).toMatchObject({
          ticket: expect.objectContaining({ id }),
          assignedPrincipalId: agentB,
          previousPrincipalId: expect.not.stringMatching(agentB),
          assignedTeamId: people.teams.support,
          previousTeamId: null,
        })
        const sql = supportDb()
        await expect
          .poll(
            async () =>
              (
                await sql`SELECT count(*)::int AS n FROM in_app_notifications
                  WHERE principal_id = ${toUuid(agentB as `principal_${string}`)}
                    AND type = 'ticket_assigned' AND metadata::text LIKE ${`%${id}%`}`
              )[0].n,
            { timeout: 15_000 }
          )
          .toBeGreaterThanOrEqual(1)
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-89 ticket.replied carries the message, sender type, public author label and requester',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['ticket.replied', 'message.created'])
      try {
        const id = await createCustomerTicket(
          api,
          people.people.customer.principalId,
          `Reply ${marker}`
        )
        const res = await api.post(`/api/v1/tickets/${id}/reply`, {
          data: { content: `Ticket answer ${marker}` },
        })
        expect(res.status(), await res.text()).toBe(201)
        const [d] = await deliveriesOf(marker, 'ticket.replied', id)
        const { data } = bodyOf<Json>(d)
        expect(data).toMatchObject({
          ticket: expect.objectContaining({ id }),
          messageId: expect.any(String),
          content: `Ticket answer ${marker}`,
          attachments: null,
          senderType: 'agent',
          title: `Reply ${marker}`,
          requesterPrincipalId: people.people.customer.principalId,
        })
        expect(data.authorName).toEqual(expect.any(String))
        // On the linked pair the same reply is a conversation message too.
        const [m] = await sink.waitForDeliveries(marker, {
          where: (x) =>
            x.headers['x-quackback-event'] === 'message.created' &&
            x.body.includes(`Ticket answer ${marker}`),
        })
        expect(bodyOf<{ message: Json }>(m).data.message.id).toBe(data.messageId)
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )

  test(
    'API-90 ticket.note_added carries the note',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, ['ticket.note_added'])
      try {
        const id = await createCustomerTicket(
          api,
          people.people.customer.principalId,
          `Note ${marker}`
        )
        const res = await api.post(`/api/v1/tickets/${id}/note`, {
          data: { content: `Ticket note ${marker}` },
        })
        expect(res.status(), await res.text()).toBe(201)
        const [d] = await deliveriesOf(marker, 'ticket.note_added', id)
        expect(bodyOf<Json>(d).data).toMatchObject({
          ticket: expect.objectContaining({ id }),
          messageId: expect.any(String),
          content: `Ticket note ${marker}`,
          senderType: 'agent',
          title: `Note ${marker}`,
          authorName: expect.any(String),
        })
      } finally {
        await unsubscribe(api, hook)
        await api.dispose()
      }
    }
  )
})
