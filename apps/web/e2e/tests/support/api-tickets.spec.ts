/**
 * The REST API for tickets (/api/v1/tickets, /api/v1/ticket-statuses).
 * Journeys API-25..42.
 *
 * Each test makes its own customer (requester) and filters lists by it, so
 * other tests' tickets never enter an assertion.
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  INBOX_PERMISSIONS,
  apiFor,
  backingConversationOf,
  createKey,
  eventsFor,
  expectJson,
  newTeammate,
  placeTicket,
  seedCustomer,
  uuidOf,
  waitForEvent,
} from '../../support/api-client'

test.describe.configure({ timeout: 60_000 })

const TICKET_KEYS = [
  'assigneePrincipalId',
  'assigneeTeamId',
  'companyId',
  'createdAt',
  'dueAt',
  'firstResponseAt',
  'id',
  'number',
  'priority',
  'reference',
  'reopenedCount',
  'requesterPrincipalId',
  'resolvedAt',
  'stage',
  'status',
  'ticketType',
  'title',
  'type',
  'updatedAt',
]
const TICKET_MESSAGE_KEYS = [
  'attachments',
  'authorName',
  'authorPrincipalId',
  'content',
  'contentJson',
  'createdAt',
  'id',
  'isInternal',
  'senderType',
  'ticketId',
]

type Api = Awaited<ReturnType<typeof apiFor>>

async function createTicket(api: Api, data: Record<string, unknown>) {
  return (await expectJson(await api.post('/api/v1/tickets', { data }), 201)).data
}

async function workspaceApi(
  playwright: Parameters<typeof apiFor>[0],
  baseURL: string | undefined,
  adminEmail: string
) {
  const { key } = createKey({ creatorEmail: adminEmail, kind: 'workspace' })
  return apiFor(playwright, baseURL, key)
}

async function statuses(api: Api) {
  return (await expectJson(await api.get('/api/v1/ticket-statuses'), 200)).data as Array<{
    id: string
    name: string
    category: string
    stage: string
    position: number
  }>
}

test.describe('REST tickets: reads', () => {
  test(
    'API-25 ticket statuses list the documented shape, by category then position',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const body = await expectJson(await api.get('/api/v1/ticket-statuses'), 200)
      expect(body.meta).toBeUndefined()
      expect(body.data.length).toBeGreaterThan(0)
      for (const s of body.data) {
        expect(Object.keys(s).sort()).toEqual(
          ['category', 'color', 'id', 'isDefault', 'name', 'position', 'slug', 'stage'].sort()
        )
        expect(s.id).toMatch(/^ticket_status_/)
      }
      // Category groups are contiguous, positions ascend inside each.
      const cats = body.data.map((s: { category: string }) => s.category)
      const groups = cats.filter((c: string, i: number) => i === 0 || cats[i - 1] !== c)
      expect(new Set(groups).size).toBe(groups.length)
      for (let i = 1; i < body.data.length; i++) {
        if (body.data[i].category === body.data[i - 1].category) {
          expect(body.data[i].position).toBeGreaterThanOrEqual(body.data[i - 1].position)
        }
      }
      await api.dispose()
    }
  )

  test(
    'API-26 API-29 list and get tickets answer the documented shape; malformed and missing ids',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const ticket = await createTicket(api, {
        title: `List ${marker}`,
        requesterPrincipalId: customer.principalId,
      })
      const list = await expectJson(
        await api.get(`/api/v1/tickets?requesterPrincipalId=${customer.principalId}`),
        200
      )
      expect(list.meta).toBeUndefined()
      expect(list.data).toHaveLength(1)
      expect(Object.keys(list.data[0]).sort()).toEqual(TICKET_KEYS)
      expect(list.data[0]).toMatchObject({
        id: ticket.id,
        type: 'customer',
        title: `List ${marker}`,
        requesterPrincipalId: customer.principalId,
        status: { name: expect.any(String), category: 'open' },
      })

      const one = await expectJson(await api.get(`/api/v1/tickets/${ticket.id}`), 200)
      expect(Object.keys(one.data).sort()).toEqual(TICKET_KEYS)
      expect(one.data.id).toBe(ticket.id)

      const bad = await expectJson(await api.get('/api/v1/tickets/not-a-ticket'), 400)
      expect(bad.error.message).toBe('Invalid ticket ID format')
      const missing = await expectJson(
        await api.get(`/api/v1/tickets/${generateId('ticket')}`),
        404
      )
      expect(missing.error).toEqual({ code: 'NOT_FOUND', message: 'Ticket not found' })

      // A soft-deleted ticket reads as missing.
      await supportDb()`UPDATE tickets SET deleted_at = NOW() WHERE id = ${uuidOf(ticket.id)}`
      const deleted = await expectJson(await api.get(`/api/v1/tickets/${ticket.id}`), 404)
      expect(deleted.error.message).toBe('Ticket not found')
      await api.dispose()
    }
  )

  test(
    'API-27 ticket filters, sort and limit apply; a junk ticketTypeId is ignored',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const first = await createTicket(api, {
        title: `First ${marker}`,
        priority: 'low',
        requesterPrincipalId: customer.principalId,
      })
      const second = await createTicket(api, {
        title: `Second ${marker}`,
        priority: 'urgent',
        requesterPrincipalId: customer.principalId,
      })
      const closedStatus = (await statuses(api)).find((s) => s.category === 'closed')!
      await expectJson(
        await api.post(`/api/v1/tickets/${first.id}/status`, {
          data: { statusId: closedStatus.id },
        }),
        200
      )
      const q = (extra: string) =>
        api
          .get(`/api/v1/tickets?requesterPrincipalId=${customer.principalId}&${extra}`)
          .then((r) => expectJson(r, 200))
          .then((b) => b.data.map((t: { id: string }) => t.id))

      expect(await q('type=customer')).toHaveLength(2)
      expect(await q('type=tracker')).toEqual([])
      expect(await q('statusCategory=closed')).toEqual([first.id])
      expect(await q('statusCategory=open')).toEqual([second.id])
      expect(await q(`stage=${closedStatus.stage}`)).toContain(first.id)
      // recent/oldest order by last update (the status change touched `first`
      // last); created by creation time.
      expect(await q('sort=recent')).toEqual([first.id, second.id])
      expect(await q('sort=oldest')).toEqual([second.id, first.id])
      expect(await q('sort=created')).toEqual([second.id, first.id])
      expect((await q('sort=priority'))[0]).toBe(second.id)
      expect(await q('limit=1')).toHaveLength(1)
      // A junk registry type id is dropped, not sent to the uuid query.
      expect(await q('ticketTypeId=junk')).toHaveLength(2)
      await api.dispose()
    }
  )

  test(
    'API-28 a scoped personal key lists only its own and team tickets; a workspace key lists all',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const mate = newTeammate(`Ticket scope ${marker}`, INBOX_PERMISSIONS, [people.teams.billing])
      const w = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const own = await createTicket(w, {
        title: `own ${marker}`,
        requesterPrincipalId: customer.principalId,
      })
      const team = await createTicket(w, {
        title: `team ${marker}`,
        requesterPrincipalId: customer.principalId,
      })
      const other = await createTicket(w, {
        title: `other ${marker}`,
        requesterPrincipalId: customer.principalId,
      })
      await placeTicket(own.id, { assigneePrincipalId: mate.principalId })
      await placeTicket(team.id, { teamId: people.teams.billing })
      await placeTicket(other.id, { teamId: people.teams.support })

      const { key } = createKey({ creatorEmail: mate.email })
      const p = await apiFor(playwright, baseURL, key)
      const ids = async (api: Api) =>
        (
          await expectJson(
            await api.get(`/api/v1/tickets?requesterPrincipalId=${customer.principalId}`),
            200
          )
        ).data
          .map((t: { id: string }) => t.id)
          .sort()
      expect(await ids(p)).toEqual([own.id, team.id].sort())
      expect(await ids(w)).toEqual([own.id, team.id, other.id].sort())
      await p.dispose()
      await w.dispose()
    }
  )

  test(
    'API-34 ticket messages are the shared thread, oldest first, notes only with includeInternal',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const ticket = await createTicket(api, {
        title: `Thread ${marker}`,
        description: `Opening ${marker}`,
        requesterPrincipalId: customer.principalId,
      })
      const conversationId = (await backingConversationOf(ticket.id))!
      // One row on the linked conversation, one on the ticket itself (a note).
      await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/reply`, {
          data: { content: `Conversation reply ${marker}` },
        }),
        201
      )
      await expectJson(
        await api.post(`/api/v1/tickets/${ticket.id}/note`, {
          data: { content: `Ticket note ${marker}` },
        }),
        201
      )
      const pub = await expectJson(await api.get(`/api/v1/tickets/${ticket.id}/messages`), 200)
      const contents = pub.data.map((m: { content: string }) => m.content)
      expect(contents).toEqual([`Opening ${marker}`, `Conversation reply ${marker}`])
      expect(Object.keys(pub.data[0]).sort()).toEqual(TICKET_MESSAGE_KEYS)
      const all = await expectJson(
        await api.get(`/api/v1/tickets/${ticket.id}/messages?includeInternal=true`),
        200
      )
      const note = all.data.find((m: { content: string }) => m.content === `Ticket note ${marker}`)
      expect(note).toMatchObject({ isInternal: true, ticketId: ticket.id })
      // Oldest first.
      const times = all.data.map((m: { createdAt: string }) => Date.parse(m.createdAt))
      expect([...times].sort((a, b) => a - b)).toEqual(times)
      await api.dispose()
    }
  )

  test(
    'API-35 ticket message paging uses before with the oldest id and ignores limit and cursor',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      test.setTimeout(120_000)
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const ticket = await createTicket(api, { type: 'back_office', title: `Paging ${marker}` })
      // More rows than one page; seeded straight into the ticket thread.
      const sql = supportDb()
      const { toUuid } = await import('@quackback/ids')
      for (let i = 0; i < 60; i++) {
        await sql`INSERT INTO conversation_messages
                  (id, ticket_id, sender_type, content, is_internal, created_at)
                VALUES (${toUuid(generateId('conversation_msg'))}, ${uuidOf(ticket.id)}, 'agent',
                        ${`Row ${i} ${marker}`}, false, NOW() - make_interval(secs => ${600 - i}))`
      }
      const first = await expectJson(
        await api.get(`/api/v1/tickets/${ticket.id}/messages?limit=5`),
        200
      )
      expect(first.data.length).toBeGreaterThan(5) // limit is ignored
      expect(first.meta.pagination.hasMore).toBe(true)
      expect(first.meta.pagination.cursor).toBe(first.data[0].id) // oldest loaded
      const sameWithCursor = await expectJson(
        await api.get(`/api/v1/tickets/${ticket.id}/messages?cursor=${first.data[0].id}`),
        200
      )
      expect(sameWithCursor.data.map((m: { id: string }) => m.id)).toEqual(
        first.data.map((m: { id: string }) => m.id)
      )
      const older = await expectJson(
        await api.get(
          `/api/v1/tickets/${ticket.id}/messages?before=${first.meta.pagination.cursor}`
        ),
        200
      )
      const seen = new Set([...first.data, ...older.data].map((m: { id: string }) => m.id))
      expect(seen.size).toBe(first.data.length + older.data.length)
      expect(older.meta.pagination.hasMore).toBe(false)
      expect(older.meta.pagination.cursor).toBeNull()
      expect(seen.size).toBe(60)
      await api.dispose()
    }
  )
})

test.describe('REST tickets: create', () => {
  test(
    'API-30 a customer ticket with a requester gets a backing conversation in the same call',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const ticket = await createTicket(api, {
        title: `Customer ${marker}`,
        description: `**Broken** ${marker}`,
        priority: 'high',
        requesterPrincipalId: customer.principalId,
      })
      expect(Object.keys(ticket).sort()).toEqual(TICKET_KEYS)
      expect(ticket).toMatchObject({ type: 'customer', priority: 'high' })
      const conversationId = await backingConversationOf(ticket.id)
      expect(conversationId).toMatch(/^conversation_/)
      const conversation = await expectJson(
        await api.get(`/api/v1/conversations/${conversationId}`),
        200
      )
      expect(conversation.data.visitorPrincipalId).toBe(customer.principalId)
      const messages = await expectJson(await api.get(`/api/v1/tickets/${ticket.id}/messages`), 200)
      expect(messages.data[0].content).toContain(`**Broken** ${marker}`)
      expect(JSON.stringify(messages.data[0].contentJson)).toContain('"bold"')
      await waitForEvent(ticket.id, 'ticket.created')
      await waitForEvent(conversationId!, 'conversation.created')
      await api.dispose()
    }
  )

  test(
    'API-31 back-office, tracker and requester-less tickets have no conversation and no first response',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      for (const data of [
        { type: 'back_office', title: `Back office ${marker}` },
        { type: 'tracker', title: `Tracker ${marker}` },
        { title: `No requester ${marker}` },
      ]) {
        const ticket = await createTicket(api, data)
        expect(ticket.type).toBe(data.type ?? 'customer')
        expect(await backingConversationOf(ticket.id)).toBeNull()
        // A reply on the ticket itself still never makes a first response here.
        await expectJson(
          await api.post(`/api/v1/tickets/${ticket.id}/reply`, {
            data: { content: `Reply ${marker}` },
          }),
          201
        )
        const after = await expectJson(await api.get(`/api/v1/tickets/${ticket.id}`), 200)
        expect(after.data.firstResponseAt, JSON.stringify(data)).toBeNull()
      }
      await api.dispose()
    }
  )

  test(
    'API-32 a registry ticketTypeId sets the type; a contradicting type is refused',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const sql = supportDb()
      const [row] = await sql`SELECT id FROM ticket_types WHERE slug = 'back_office' LIMIT 1`
      const { fromUuid } = await import('@quackback/ids')
      const ticketTypeId = fromUuid('ticket_type', row.id as string)
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const ticket = await createTicket(api, { ticketTypeId, title: `Typed ${marker}` })
      expect(ticket.type).toBe('back_office')
      expect(ticket.ticketType).toMatchObject({ id: ticketTypeId, slug: 'back_office' })

      const mismatch = await api.post('/api/v1/tickets', {
        data: { ticketTypeId, type: 'tracker', title: `Mismatch ${marker}` },
      })
      const body = await expectJson(mismatch, 400)
      expect(body.error.code).toBe('VALIDATION_ERROR')
      const malformed = await expectJson(
        await api.post('/api/v1/tickets', { data: { ticketTypeId: 'nope', title: marker } }),
        400
      )
      expect(malformed.error.message).toBe('Invalid ticket type ID format')
      await api.dispose()
    }
  )

  test(
    'API-33 create validation: schema 400s and bad requester or company ids',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      for (const [data, field] of [
        [{}, 'title'],
        [{ title: 'x'.repeat(301) }, 'title'],
        [{ title: 'ok', description: 'x'.repeat(4001) }, 'description'],
      ] as const) {
        const body = await expectJson(await api.post('/api/v1/tickets', { data }), 400)
        expect(body.error.code).toBe('BAD_REQUEST')
        expect(Object.keys(body.error.details.errors)).toContain(field)
      }
      const requester = await expectJson(
        await api.post('/api/v1/tickets', { data: { title: 'ok', requesterPrincipalId: 'bob' } }),
        400
      )
      expect(requester.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Invalid requester principal ID format',
      })
      const company = await expectJson(
        await api.post('/api/v1/tickets', { data: { title: 'ok', companyId: 'acme' } }),
        400
      )
      expect(company.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Invalid company ID format',
      })
      await api.dispose()
    }
  )
})

test.describe('REST tickets: writes', () => {
  test(
    'API-36 a reply on a linked customer ticket lands on the conversation and fires both events',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const w = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const ticket = await createTicket(w, {
        title: `Reply ${marker}`,
        requesterPrincipalId: customer.principalId,
      })
      const conversationId = (await backingConversationOf(ticket.id))!
      const replier = createKey({ creatorEmail: people.people.admin.email })
      const api = await apiFor(playwright, baseURL, replier.key)
      const reply = await expectJson(
        await api.post(`/api/v1/tickets/${ticket.id}/reply`, {
          data: { content: `Answer ${marker}` },
        }),
        201
      )
      expect(Object.keys(reply.data).sort()).toEqual(TICKET_MESSAGE_KEYS)
      expect(reply.data).toMatchObject({ senderType: 'agent', isInternal: false })

      const convMessages = await expectJson(
        await w.get(`/api/v1/conversations/${conversationId}/messages`),
        200
      )
      expect(convMessages.data.map((m: { content: string }) => m.content)).toContain(
        `Answer ${marker}`
      )
      const ticketMessages = await expectJson(
        await w.get(`/api/v1/tickets/${ticket.id}/messages`),
        200
      )
      expect(ticketMessages.data.map((m: { content: string }) => m.content)).toContain(
        `Answer ${marker}`
      )

      await waitForEvent(reply.data.id, 'message.created')
      const [replied] = await waitForEvent(ticket.id, 'ticket.replied')
      expect(JSON.stringify(replied.payload)).toContain(ticket.id)
      const sql = supportDb()
      const watchers = await sql`SELECT reason FROM ticket_subscriptions
      WHERE ticket_id = ${uuidOf(ticket.id)} AND principal_id = ${uuidOf(replier.principalId)}`
      expect(watchers.map((r) => r.reason)).toContain('replier')
      await api.dispose()
      await w.dispose()
    }
  )

  test(
    'API-37 a reply to a tracker stays on the tracker and does not fan out',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const w = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const tracker = await createTicket(w, { type: 'tracker', title: `Tracker ${marker}` })
      const linked: string[] = []
      for (const n of [1, 2]) {
        const customer = await seedCustomer(`${marker}-${n}@customers.example`)
        const t = await createTicket(w, {
          title: `Linked ${n} ${marker}`,
          requesterPrincipalId: customer.principalId,
        })
        linked.push(t.id)
      }
      const sql = supportDb()
      for (const id of linked) {
        await sql`INSERT INTO ticket_links (tracker_ticket_id, linked_ticket_id)
                VALUES (${uuidOf(tracker.id)}, ${uuidOf(id)})`
      }
      await expectJson(
        await w.post(`/api/v1/tickets/${tracker.id}/reply`, {
          data: { content: `Fix shipped ${marker}` },
        }),
        201
      )
      const trackerMsgs = await expectJson(
        await w.get(`/api/v1/tickets/${tracker.id}/messages`),
        200
      )
      expect(trackerMsgs.data.map((m: { content: string }) => m.content)).toContain(
        `Fix shipped ${marker}`
      )
      for (const id of linked) {
        const msgs = await expectJson(
          await w.get(`/api/v1/tickets/${id}/messages?includeInternal=true`),
          200
        )
        expect(msgs.data.map((m: { content: string }) => m.content)).not.toContain(
          `Fix shipped ${marker}`
        )
      }
      await w.dispose()
    }
  )

  test(
    'API-38 a ticket note stays on the ticket even when linked; ticket.note_added only',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const ticket = await createTicket(api, {
        title: `Note ${marker}`,
        requesterPrincipalId: customer.principalId,
      })
      const conversationId = (await backingConversationOf(ticket.id))!
      const note = await expectJson(
        await api.post(`/api/v1/tickets/${ticket.id}/note`, {
          data: { content: `Note ${marker}` },
        }),
        201
      )
      expect(note.data).toMatchObject({ isInternal: true, ticketId: ticket.id })
      const sql = supportDb()
      const [row] = await sql`SELECT conversation_id, ticket_id FROM conversation_messages
                            WHERE id = ${uuidOf(note.data.id)}`
      expect(row.conversation_id).toBeNull()
      const conv = await expectJson(
        await api.get(`/api/v1/conversations/${conversationId}/messages?includeInternal=true`),
        200
      )
      expect(conv.data.map((m: { content: string }) => m.content)).not.toContain(`Note ${marker}`)
      await waitForEvent(ticket.id, 'ticket.note_added')
      expect(await eventsFor(note.data.id, ['message.note_created'])).toHaveLength(0)
      await api.dispose()
    }
  )

  test(
    'API-39 partial assign: absent sides stay, null clears, {} is a no-op; ticket.assigned fires',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const ticket = await createTicket(api, { type: 'back_office', title: `Assign ${marker}` })
      const url = `/api/v1/tickets/${ticket.id}/assign`
      const agentB = people.people.agentB.principalId
      const team = people.teams.support
      // A ticket a key opens starts assigned to the key itself; clear it first.
      let body = await expectJson(await api.post(url, { data: { assigneePrincipalId: null } }), 200)
      expect(body.data).toMatchObject({ assigneeTeamId: null, assigneePrincipalId: null })

      body = await expectJson(await api.post(url, { data: { assigneeTeamId: team } }), 200)
      expect(body.data).toMatchObject({ assigneeTeamId: team, assigneePrincipalId: null })
      body = await expectJson(await api.post(url, { data: { assigneePrincipalId: agentB } }), 200)
      expect(body.data).toMatchObject({ assigneeTeamId: team, assigneePrincipalId: agentB })
      body = await expectJson(await api.post(url, { data: {} }), 200)
      expect(body.data).toMatchObject({ assigneeTeamId: team, assigneePrincipalId: agentB })
      body = await expectJson(await api.post(url, { data: { assigneePrincipalId: null } }), 200)
      expect(body.data).toMatchObject({ assigneeTeamId: team, assigneePrincipalId: null })

      const events = await expect
        .poll(async () => (await eventsFor(ticket.id, ['ticket.assigned'])).length)
        .toBeGreaterThanOrEqual(4)
      void events
      const payloads = (await eventsFor(ticket.id, ['ticket.assigned'])).map((e) => e.payload)
      test.info().annotations.push({ type: 'payloads', description: JSON.stringify(payloads) })
      expect(payloads[2]).toMatchObject({
        assignedPrincipalId: agentB,
        previousPrincipalId: null,
        assignedTeamId: team,
        previousTeamId: team,
      })
      const sql = supportDb()
      const activity = await sql`SELECT count(*)::int AS n FROM ticket_activity
      WHERE ticket_id = ${uuidOf(ticket.id)} AND type = 'ticket.assigned'`
      expect(activity[0].n).toBeGreaterThanOrEqual(3)

      const badPerson = await expectJson(
        await api.post(url, { data: { assigneePrincipalId: 'x' } }),
        400
      )
      expect(badPerson.error.message).toBe('Invalid assignee principal ID format')
      const badTeam = await expectJson(await api.post(url, { data: { assigneeTeamId: 'x' } }), 400)
      expect(badTeam.error.message).toBe('Invalid assignee team ID format')
      await api.dispose()
    }
  )

  test(
    'API-40 status by id: name, category, stage, resolvedAt; tracker cascades; no first response',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const all = await statuses(api)
      const closed = all.find((s) => s.category === 'closed')!
      const ticket = await createTicket(api, { type: 'back_office', title: `Status ${marker}` })
      const body = await expectJson(
        await api.post(`/api/v1/tickets/${ticket.id}/status`, { data: { statusId: closed.id } }),
        200
      )
      expect(body.data.status).toEqual({ name: closed.name, category: 'closed' })
      expect(body.data.stage).toBe(closed.stage)
      expect(body.data.resolvedAt).not.toBeNull()
      expect(body.data.firstResponseAt).toBeNull()
      const [event] = await waitForEvent(ticket.id, 'ticket.status_changed')
      expect(event.payload).toMatchObject({ previousStatus: 'open', newStatus: 'closed' })

      // A tracker's status cascades to its linked tickets.
      const tracker = await createTicket(api, { type: 'tracker', title: `Tracker ${marker}` })
      const customer = await seedCustomer(`${marker}@customers.example`)
      const linked = await createTicket(api, {
        title: `Linked ${marker}`,
        requesterPrincipalId: customer.principalId,
      })
      await supportDb()`INSERT INTO ticket_links (tracker_ticket_id, linked_ticket_id)
                      VALUES (${uuidOf(tracker.id)}, ${uuidOf(linked.id)})`
      await expectJson(
        await api.post(`/api/v1/tickets/${tracker.id}/status`, { data: { statusId: closed.id } }),
        200
      )
      await expect
        .poll(
          async () =>
            (await expectJson(await api.get(`/api/v1/tickets/${linked.id}`), 200)).data.stage
        )
        .toBe(closed.stage)

      const empty = await expectJson(
        await api.post(`/api/v1/tickets/${ticket.id}/status`, { data: { statusId: '' } }),
        400
      )
      expect(empty.error.code).toBe('BAD_REQUEST')
      const bad = await expectJson(
        await api.post(`/api/v1/tickets/${ticket.id}/status`, { data: { statusId: 'status_1' } }),
        400
      )
      expect(bad.error.message).toBe('Invalid status ID format')
      await api.dispose()
    }
  )

  test(
    'API-41 ticket priority changes, fires no event and sets no first response',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const ticket = await createTicket(api, { type: 'back_office', title: `Priority ${marker}` })
      const before = (await eventsFor(ticket.id)).length
      const body = await expectJson(
        await api.post(`/api/v1/tickets/${ticket.id}/priority`, { data: { priority: 'low' } }),
        200
      )
      expect(body.data.priority).toBe('low')
      expect(body.data.firstResponseAt).toBeNull()
      await new Promise((r) => setTimeout(r, 1_000))
      const after = await eventsFor(ticket.id)
      expect(after.slice(before).filter((e) => e.type.startsWith('ticket.'))).toEqual([])
      await api.dispose()
    }
  )

  test(
    "API-42 every ticket call through a personal key on another team's ticket is 404",
    { tag: '@smoke' },
    async ({ playwright, baseURL, people, marker }) => {
      const mate = newTeammate(`Ticket writer ${marker}`, INBOX_PERMISSIONS, [people.teams.billing])
      const w = await workspaceApi(playwright, baseURL, people.people.admin.email)
      const ticket = await createTicket(w, { type: 'back_office', title: `Hidden ${marker}` })
      await placeTicket(ticket.id, { teamId: people.teams.support })
      const status = (await statuses(w)).find((s) => s.category === 'closed')!
      const { key } = createKey({ creatorEmail: mate.email })
      const api = await apiFor(playwright, baseURL, key)
      const base = `/api/v1/tickets/${ticket.id}`
      for (const [name, res] of [
        ['get', await api.get(base)],
        ['messages', await api.get(`${base}/messages`)],
        ['reply', await api.post(`${base}/reply`, { data: { content: marker } })],
        ['note', await api.post(`${base}/note`, { data: { content: marker } })],
        [
          'assign',
          await api.post(`${base}/assign`, { data: { assigneePrincipalId: mate.principalId } }),
        ],
        ['status', await api.post(`${base}/status`, { data: { statusId: status.id } })],
        ['priority', await api.post(`${base}/priority`, { data: { priority: 'urgent' } })],
      ] as const) {
        expect(res.status(), `${name}: ${await res.text()}`).toBe(404)
      }
      const after = await expectJson(await w.get(base), 200)
      expect(after.data).toMatchObject({
        assigneePrincipalId: null,
        priority: ticket.priority,
        status: ticket.status,
      })
      const msgs = await expectJson(await w.get(`${base}/messages?includeInternal=true`), 200)
      expect(msgs.data).toEqual([])
      await api.dispose()
      await w.dispose()
    }
  )
})
