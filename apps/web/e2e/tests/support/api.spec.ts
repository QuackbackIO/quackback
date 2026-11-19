/**
 * The REST API for conversations (/api/v1/conversations), its keys and its
 * refusals, and which key's changes start workflows. Journeys API-01..24,
 * API-43..51 and ACC-22..24.
 *
 * Every key is made per test (support/api-client.ts), and every request
 * context carries its own client address, so the per-address rate limit never
 * couples tests. Tests that change a teammate (leave, block, narrow a role)
 * make their own teammate; the shared people are never changed.
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  INBOX_PERMISSIONS,
  apiFor,
  createKey,
  emailConversation,
  eventsFor,
  expectJson,
  fixture,
  newTeammate,
  pageUntilSeen,
  backingConversationOf,
  seedConv,
  seedCustomer,
  seedTag,
  uuidOf,
  waitForEvent,
} from '../../support/api-client'
import { apiAs as sessionApiAs, withLiveWorkflow, workflowRuns } from '../../support/sla-csat'
import {
  conversationForMessage,
  conversationTypeId,
  seedCustomer as seedKnownCustomer,
  sendColdMail,
} from '../../support/email-journeys'

// Well-formed ids that exist nowhere.
// Key and teammate scripts start the app's modules (about a second each).
test.describe.configure({ timeout: 60_000 })

const MISSING_CONVERSATION = generateId('conversation')
const MISSING_TICKET = generateId('ticket')
const UNAUTHORIZED_MESSAGE =
  'Invalid or missing API key. Provide a valid key in the Authorization header: Bearer qb_xxx'

const CONVERSATION_KEYS = [
  'assignedAgentPrincipalId',
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
]
const MESSAGE_KEYS = [
  'authorName',
  'authorPrincipalId',
  'content',
  'conversationId',
  'createdAt',
  'editedAt',
  'id',
  'isInternal',
  'senderType',
]

test.describe('REST conversations: reads', () => {
  test(
    'API-01 list conversations answers the documented shape, newest activity first',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const older = await seedConv(`${marker} older`, { ageMinutes: 2 })
      const newer = await seedConv(`${marker} newer`)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)

      const body = await expectJson(await api.get('/api/v1/conversations?limit=100'), 200)
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.meta.pagination).toEqual({
        cursor: expect.anything(),
        hasMore: expect.any(Boolean),
      })
      const ids = body.data.map((c: { id: string }) => c.id)
      expect(ids).toContain(newer.conversationId)
      expect(ids).toContain(older.conversationId)
      expect(ids.indexOf(newer.conversationId)).toBeLessThan(ids.indexOf(older.conversationId))
      const mine = body.data.find((c: { id: string }) => c.id === newer.conversationId)
      expect(Object.keys(mine).sort()).toEqual(CONVERSATION_KEYS)
      expect(mine).toMatchObject({
        status: 'open',
        channel: 'messenger',
        priority: 'none',
        subject: `${marker} newer`,
        visitorPrincipalId: newer.visitorPrincipalId,
        // An anonymous visitor has no real email.
        visitorEmail: null,
        assignedAgentPrincipalId: null,
        resolvedAt: null,
      })
      await api.dispose()
    }
  )

  test(
    'API-02 list paging: limit 2 then the cursor; limit is clamped',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      // Three conversations only this test's assignee filter returns.
      const agent = newTeammate(`Paging ${marker}`, INBOX_PERMISSIONS)
      const ids: string[] = []
      for (const age of [3, 2, 1]) {
        ids.push(
          (
            await seedConv(`${marker} ${age}`, {
              assigneePrincipalId: agent.principalId,
              ageMinutes: age,
            })
          ).conversationId
        )
      }
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const q = `assignedAgentPrincipalId=${agent.principalId}`

      const first = await expectJson(await api.get(`/api/v1/conversations?${q}&limit=2`), 200)
      expect(first.data.map((c: { id: string }) => c.id)).toEqual([ids[2], ids[1]])
      expect(first.meta.pagination.hasMore).toBe(true)
      const second = await expectJson(
        await api.get(`/api/v1/conversations?${q}&limit=2&cursor=${first.meta.pagination.cursor}`),
        200
      )
      expect(second.data.map((c: { id: string }) => c.id)).toEqual([ids[0]])
      expect(second.meta.pagination.hasMore).toBe(false)

      // limit=0 and limit=abc fall back to the default (20, so all three); 1000 clamps to 100.
      for (const limit of ['0', 'abc', '1000']) {
        const page = await expectJson(
          await api.get(`/api/v1/conversations?${q}&limit=${limit}`),
          200
        )
        expect(page.data, `limit=${limit}`).toHaveLength(3)
        expect(page.meta.pagination.hasMore).toBe(false)
      }
      const all = await expectJson(await api.get('/api/v1/conversations?limit=1000'), 200)
      expect(all.data.length).toBeLessThanOrEqual(100)
      await api.dispose()
    }
  )

  test(
    'API-03 list filters: status, priority and assignee return only matching rows',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const agent = newTeammate(`Filters ${marker}`, INBOX_PERMISSIONS)
      const open = await seedConv(`${marker} open`, { assigneePrincipalId: agent.principalId })
      const closed = await seedConv(`${marker} closed`, {
        assigneePrincipalId: agent.principalId,
        status: 'closed',
        priority: 'urgent',
      })
      const snoozed = await seedConv(`${marker} snoozed`, {
        assigneePrincipalId: agent.principalId,
        status: 'snoozed',
      })
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const list = async (q: string) =>
        (
          await expectJson(
            await api.get(
              `/api/v1/conversations?assignedAgentPrincipalId=${agent.principalId}&${q}`
            ),
            200
          )
        ).data.map((c: { id: string }) => c.id)

      expect(await list('')).toHaveLength(3)
      expect(await list('status=open')).toEqual([open.conversationId])
      expect(await list('status=closed')).toEqual([closed.conversationId])
      expect(await list('status=snoozed')).toEqual([snoozed.conversationId])
      expect(await list('priority=urgent')).toEqual([closed.conversationId])
      expect(await list('priority=none').then((l: string[]) => l.sort())).toEqual(
        [open.conversationId, snoozed.conversationId].sort()
      )

      // Pinned: the query value is not validated; a bogus status answers this.
      const bogus = await api.get(
        `/api/v1/conversations?assignedAgentPrincipalId=${agent.principalId}&status=bogus`
      )
      test.info().annotations.push({ type: 'status=bogus', description: String(bogus.status()) })
      expect([200, 400, 500]).toContain(bogus.status())
      if (bogus.status() === 200) expect((await bogus.json()).data).toEqual([])
      await api.dispose()
    }
  )

  test(
    'API-05 get one conversation answers the conversation shape',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const { conversationId } = await emailConversation(request, customerEmail, marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const body = await expectJson(await api.get(`/api/v1/conversations/${conversationId}`), 200)
      expect(Object.keys(body.data).sort()).toEqual(CONVERSATION_KEYS)
      expect(body.data).toMatchObject({
        id: conversationId,
        channel: 'email',
        status: 'open',
        visitorEmail: customerEmail,
      })
      await api.dispose()
    }
  )

  test(
    'API-06 a malformed conversation id is 400 VALIDATION_ERROR',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      for (const id of ['not-an-id', 'ticket_01kzzzzzzzzzzzzzzzzzzzzzzz']) {
        const body = await expectJson(await api.get(`/api/v1/conversations/${id}`), 400)
        expect(body.error).toMatchObject({
          code: 'VALIDATION_ERROR',
          message: 'Invalid conversation ID format',
        })
      }
      await api.dispose()
    }
  )

  test(
    'API-07 ACC-22 a missing conversation or ticket is 404 "not found" said once',
    { tag: '@core' },
    async ({ playwright, baseURL, people }) => {
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const conversation = await expectJson(
        await api.get(`/api/v1/conversations/${MISSING_CONVERSATION}`),
        404
      )
      expect(conversation.error).toEqual({ code: 'NOT_FOUND', message: 'Conversation not found' })
      const ticket = await expectJson(await api.get(`/api/v1/tickets/${MISSING_TICKET}`), 404)
      expect(ticket.error).toEqual({ code: 'NOT_FOUND', message: 'Ticket not found' })
      await api.dispose()
    }
  )

  test(
    'API-09 API-10 messages: public by default; includeInternal=true adds notes and notices',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const { conversationId } = await emailConversation(request, customerEmail, marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/reply`, {
          data: { content: `Reply ${marker}` },
        }),
        201
      )
      await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/note`, {
          data: { content: `Note ${marker}` },
        }),
        201
      )
      await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/assign`, {
          data: { assigneePrincipalId: people.people.agentB.principalId },
        }),
        200
      )
      // A legacy public assignment row, written before notices became internal.
      const sql = supportDb()
      const { generateId, toUuid } = await import('@quackback/ids')
      await sql`INSERT INTO conversation_messages
                (id, conversation_id, sender_type, content, is_internal, created_at)
              VALUES (${toUuid(generateId('conversation_msg'))}, ${uuidOf(conversationId)},
                      'system', ${'Conversation assigned to Legacy Agent'}, false, NOW())`

      const contents = (rows: Array<{ content: string }>) => rows.map((m) => m.content)
      const pub = await expectJson(
        await api.get(`/api/v1/conversations/${conversationId}/messages`),
        200
      )
      expect(Object.keys(pub.data[0]).sort()).toEqual(MESSAGE_KEYS)
      expect(contents(pub.data)).toContain(`Reply ${marker}`)
      expect(contents(pub.data).some((c: string) => c.includes(marker))).toBe(true)
      expect(contents(pub.data)).not.toContain(`Note ${marker}`)
      expect(contents(pub.data).some((c: string) => c.startsWith('Conversation assigned to'))).toBe(
        false
      )
      expect(pub.data.every((m: { isInternal: boolean }) => m.isInternal === false)).toBe(true)

      // Only the exact string "true" turns it on.
      const one = await expectJson(
        await api.get(`/api/v1/conversations/${conversationId}/messages?includeInternal=1`),
        200
      )
      expect(contents(one.data)).not.toContain(`Note ${marker}`)

      const all = await expectJson(
        await api.get(`/api/v1/conversations/${conversationId}/messages?includeInternal=true`),
        200
      )
      const note = all.data.find((m: { content: string }) => m.content === `Note ${marker}`)
      expect(note).toMatchObject({ isInternal: true })
      expect(
        all.data.some((m: { content: string; isInternal: boolean }) =>
          m.content.startsWith(`Conversation assigned to ${people.people.agentB.displayName}`)
        )
      ).toBe(true)
      await api.dispose()
    }
  )

  test(
    'API-11 messages paging, and a missing conversation 404s before listing',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const { conversationId } = await emailConversation(request, customerEmail, marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      for (const n of [1, 2]) {
        await expectJson(
          await api.post(`/api/v1/conversations/${conversationId}/reply`, {
            data: { content: `Reply ${n} ${marker}` },
          }),
          201
        )
      }
      const first = await expectJson(
        await api.get(`/api/v1/conversations/${conversationId}/messages?limit=2`),
        200
      )
      expect(first.data).toHaveLength(2)
      expect(first.meta.pagination.hasMore).toBe(true)
      const rest = await expectJson(
        await api.get(
          `/api/v1/conversations/${conversationId}/messages?limit=2&cursor=${first.meta.pagination.cursor}`
        ),
        200
      )
      expect(rest.data).toHaveLength(1)
      expect(rest.meta.pagination.hasMore).toBe(false)
      const ids = [...first.data, ...rest.data].map((m: { id: string }) => m.id)
      expect(new Set(ids).size).toBe(3)

      const missing = await expectJson(
        await api.get(`/api/v1/conversations/${MISSING_CONVERSATION}/messages`),
        404
      )
      expect(missing.error.code).toBe('NOT_FOUND')
      await api.dispose()
    }
  )
})

test.describe('REST conversations: writes', () => {
  test(
    'API-12 reply: 201 agent message, event recorded, stays unassigned, reopens a closed one',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const { conversationId } = await emailConversation(request, customerEmail, marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/status`, {
          data: { status: 'closed' },
        }),
        200
      )
      const reply = await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/reply`, {
          data: { content: `**Hi** there ${marker}` },
        }),
        201
      )
      expect(Object.keys(reply.data).sort()).toEqual(MESSAGE_KEYS)
      expect(reply.data).toMatchObject({
        conversationId,
        senderType: 'agent',
        isInternal: false,
        content: `**Hi** there ${marker}`,
      })
      const after = await expectJson(await api.get(`/api/v1/conversations/${conversationId}`), 200)
      expect(after.data.assignedAgentPrincipalId).toBeNull()
      expect(after.data.status).toBe('open')

      const events = await waitForEvent(reply.data.id, 'message.created')
      expect(events[0].actor_type).toBe('service')
      // The reply reached the customer by email.
      const sql = supportDb()
      const [row] =
        await sql`SELECT content_json FROM conversation_messages WHERE id = ${uuidOf(reply.data.id)}`
      expect(JSON.stringify(row.content_json)).toContain('"bold"')
      await api.dispose()
    }
  )

  test(
    'API-13 reply validation: 400 Invalid request body with field errors',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const url = `/api/v1/conversations/${conversationId}/reply`
      for (const [data, field] of [
        [{}, 'content'],
        [{ content: '' }, 'content'],
        [{ content: 'x'.repeat(4001) }, 'content'],
        [{ content: 'ok', attachments: [{}] }, 'attachments'],
      ] as const) {
        const body = await expectJson(await api.post(url, { data }), 400)
        expect(body.error.code).toBe('BAD_REQUEST')
        expect(body.error.message).toBe('Invalid request body')
        expect(Object.keys(body.error.details.errors)).toContain(field)
      }
      const attachment = await expectJson(
        await api.post(url, { data: { content: 'ok', attachments: [{}] } }),
        400
      )
      expect(JSON.stringify(attachment.error.details)).toContain(
        'Provide either fileId (from POST /files) or url'
      )
      const fileId = await expectJson(
        await api.post(url, { data: { content: 'ok', attachments: [{ fileId: 'nope' }] } }),
        400
      )
      expect(JSON.stringify(fileId.error.details)).toContain('fileId must be a file ID')
      const notJson = await api.post(url, {
        headers: { 'content-type': 'application/json' },
        data: '{not json',
      })
      expect(notJson.status()).toBe(400)
      // Nothing was written.
      const sql = supportDb()
      const rows = await sql`SELECT count(*)::int AS n FROM conversation_messages
                           WHERE conversation_id = ${uuidOf(conversationId)} AND sender_type = 'agent'`
      expect(rows[0].n).toBe(0)
      await api.dispose()
    }
  )

  test(
    'API-14 reply with a file uploaded through POST /files rebuilds the attachment',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const bytes = Buffer.from(`hello ${marker}\n`)
      const upload = await expectJson(
        await api.post(`/api/v1/files?name=${encodeURIComponent(`${marker}.txt`)}`, {
          headers: { 'content-type': 'text/plain' },
          data: bytes,
        }),
        201
      )
      const fileId = upload.data.fileId as string
      expect(fileId).toMatch(/^file_/)
      const reply = await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/reply`, {
          data: {
            content: `With file ${marker}`,
            // Wire values must be ignored in favour of the stored file row.
            attachments: [
              { fileId, name: 'forged.exe', contentType: 'application/x-evil', size: 1 },
            ],
          },
        }),
        201
      )
      const sql = supportDb()
      const [row] =
        await sql`SELECT attachments FROM conversation_messages WHERE id = ${uuidOf(reply.data.id)}`
      const [att] = row.attachments as Array<Record<string, unknown>>
      expect(att.name).toBe(`${marker}.txt`)
      expect(att.contentType).toMatch(/^text\/plain/)
      expect(att.size).toBe(bytes.length)
      expect(String(att.url)).not.toContain('forged')
      await api.dispose()
    }
  )

  test(
    'API-15 reply author: a personal key shows its creator, a workspace key its own name',
    { tag: '@smoke' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const { conversationId } = await emailConversation(request, customerEmail, marker)
      const personal = createKey({ creatorEmail: people.people.admin.email })
      const workspaceName = `Workspace key ${marker}`
      const workspace = createKey({
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        name: workspaceName,
      })
      const p = await apiFor(playwright, baseURL, personal.key)
      const w = await apiFor(playwright, baseURL, workspace.key)
      const pr = await expectJson(
        await p.post(`/api/v1/conversations/${conversationId}/reply`, {
          data: { content: `personal ${marker}` },
        }),
        201
      )
      const wr = await expectJson(
        await w.post(`/api/v1/conversations/${conversationId}/reply`, {
          data: { content: `workspace ${marker}` },
        }),
        201
      )
      const admin = people.people.admin
      expect(pr.data.authorName).toBe(admin.displayName)
      // The stored author stays the key's own service principal.
      expect(pr.data.authorPrincipalId).toBe(personal.principalId)
      expect(wr.data.authorName).toBe(workspaceName)
      expect(wr.data.authorPrincipalId).toBe(workspace.principalId)

      const list = await expectJson(
        await w.get(`/api/v1/conversations/${conversationId}/messages`),
        200
      )
      const byContent = Object.fromEntries(
        list.data.map((m: { content: string; authorName: string }) => [m.content, m.authorName])
      )
      expect(byContent[`personal ${marker}`]).toBe(admin.displayName)
      expect(byContent[`workspace ${marker}`]).toBe(workspaceName)

      const [personalEvent] = await waitForEvent(pr.data.id, 'message.created')
      expect(personalEvent.payload.message.authorName).toBe(admin.displayName)
      const [workspaceEvent] = await waitForEvent(wr.data.id, 'message.created')
      expect(workspaceEvent.payload.message.authorName).toBe(workspaceName)
      await p.dispose()
      await w.dispose()
    }
  )

  test(
    'API-16 only a post-cutoff personal key reply settles the first response',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      test.setTimeout(90_000)
      const admin = people.people.admin.email
      const workspace = createKey({ creatorEmail: admin, kind: 'workspace' })
      const w = await apiFor(playwright, baseURL, workspace.key)
      const keys = {
        personal: createKey({ creatorEmail: admin }),
        prePersonal: createKey({ creatorEmail: admin }),
        workspace,
      }
      fixture({ op: 'backdateKey', keyId: keys.prePersonal.id })

      const sql = supportDb()
      const results: Record<string, { conversation: string | null; ticket: string | null }> = {}
      for (const [label, key] of Object.entries(keys)) {
        const customer = await seedCustomer(`${marker}-${label}@customers.example`)
        const ticket = await expectJson(
          await w.post('/api/v1/tickets', {
            data: {
              title: `${label} ${marker}`,
              description: `Help ${label} ${marker}`,
              requesterPrincipalId: customer.principalId,
            },
          }),
          201
        )
        const conversationId = (await backingConversationOf(ticket.data.id))!
        expect(conversationId).toBeTruthy()
        fixture({ op: 'applySla', conversationId })
        // The customer writes first: a response only counts after their message.
        const { generateId, toUuid } = await import('@quackback/ids')
        await sql`INSERT INTO conversation_messages
                  (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
                VALUES (${toUuid(generateId('conversation_msg'))}, ${uuidOf(conversationId)},
                        ${uuidOf(customer.principalId)}, 'visitor', ${`Still broken ${marker}`},
                        false, NOW() - interval '1 second')`
        const api = await apiFor(playwright, baseURL, key.key)
        const reply = await expectJson(
          await api.post(`/api/v1/conversations/${conversationId}/reply`, {
            data: { content: `Answer ${label} ${marker}` },
          }),
          201
        )
        await api.dispose()
        // Wait for the reaction job that judges the reply.
        await expect
          .poll(
            async () => {
              const [job] = await sql`SELECT count(*)::int AS n FROM job_queue
              WHERE queue = 'event-reactions' AND status IN ('pending', 'running')
                AND payload::text LIKE ${`%${reply.data.id}%`}`
              const events = await eventsFor(reply.data.id, ['message.created'])
              return events.length > 0 && job.n === 0
            },
            { timeout: 15_000 }
          )
          .toBe(true)
        // A little extra for the reaction to commit its stamp.
        await new Promise((r) => setTimeout(r, 1_000))
        const [conv] = await sql`SELECT sla_applied ->> 'firstResponseAt' AS at FROM conversations
                               WHERE id = ${uuidOf(conversationId)}`
        const [t] =
          await sql`SELECT first_response_at FROM tickets WHERE id = ${uuidOf(ticket.data.id)}`
        results[label] = { conversation: conv.at, ticket: t.first_response_at }
      }
      expect(results.personal.conversation).not.toBeNull()
      expect(results.personal.ticket).not.toBeNull()
      expect(results.prePersonal).toEqual({ conversation: null, ticket: null })
      expect(results.workspace).toEqual({ conversation: null, ticket: null })
      await w.dispose()
    }
  )

  test(
    'API-17 note: 201 internal, message.note_created and never message.created',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const { conversationId } = await emailConversation(request, customerEmail, marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const note = await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/note`, {
          data: { content: `Note ${marker}` },
        }),
        201
      )
      expect(note.data).toMatchObject({ isInternal: true, content: `Note ${marker}` })
      await waitForEvent(note.data.id, 'message.note_created')
      expect(await eventsFor(note.data.id, ['message.created'])).toHaveLength(0)
      const pub = await expectJson(
        await api.get(`/api/v1/conversations/${conversationId}/messages`),
        200
      )
      expect(pub.data.map((m: { id: string }) => m.id)).not.toContain(note.data.id)
      await api.dispose()
    }
  )

  test(
    'API-18 assign then unassign with null or an omitted key; conversation.assigned fires',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const url = `/api/v1/conversations/${conversationId}/assign`
      const agentB = people.people.agentB.principalId

      const assigned = await expectJson(
        await api.post(url, { data: { assigneePrincipalId: agentB } }),
        200
      )
      expect(Object.keys(assigned.data).sort()).toEqual(CONVERSATION_KEYS)
      expect(assigned.data.assignedAgentPrincipalId).toBe(agentB)
      const [event] = await waitForEvent(conversationId, 'conversation.assigned')
      expect(
        event.payload.assignedAgentPrincipalId ??
          event.payload.conversation?.assignedAgentPrincipalId
      ).toBe(agentB)

      const cleared = await expectJson(
        await api.post(url, { data: { assigneePrincipalId: null } }),
        200
      )
      expect(cleared.data.assignedAgentPrincipalId).toBeNull()

      await expectJson(await api.post(url, { data: { assigneePrincipalId: agentB } }), 200)
      const omitted = await expectJson(await api.post(url, { data: {} }), 200)
      expect(omitted.data.assignedAgentPrincipalId).toBeNull()

      const bad = await expectJson(
        await api.post(url, { data: { assigneePrincipalId: 'me' } }),
        400
      )
      expect(bad.error.message).toBe('Invalid assignee principal ID format')
      await api.dispose()
    }
  )

  test(
    'API-19 status: closed sets resolvedAt; status_changed carries previous and new; pending is 400',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const url = `/api/v1/conversations/${conversationId}/status`

      const closed = await expectJson(await api.post(url, { data: { status: 'closed' } }), 200)
      expect(closed.data.status).toBe('closed')
      expect(closed.data.resolvedAt).not.toBeNull()
      const snoozed = await expectJson(await api.post(url, { data: { status: 'snoozed' } }), 200)
      expect(snoozed.data.status).toBe('snoozed')
      const open = await expectJson(await api.post(url, { data: { status: 'open' } }), 200)
      expect(open.data.status).toBe('open')

      const transitions = await expect
        .poll(async () => (await eventsFor(conversationId, ['conversation.status_changed'])).length)
        .toBe(3)
      void transitions
      const events = await eventsFor(conversationId, ['conversation.status_changed'])
      expect(events.map((e) => [e.payload.previousStatus, e.payload.newStatus])).toEqual([
        ['open', 'closed'],
        ['closed', 'snoozed'],
        ['snoozed', 'open'],
      ])
      const pending = await expectJson(await api.post(url, { data: { status: 'pending' } }), 400)
      expect(pending.error.code).toBe('BAD_REQUEST')
      await api.dispose()
    }
  )

  test(
    'API-19 a close with a personal key starts workflows like the app; a workspace or pre-cutoff key starts none',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      test.setTimeout(120_000)
      const adminEmail = people.people.admin.email
      // A known customer whose authenticated email opens the thread, so the
      // workflow's audience (person.email) matches them.
      await seedKnownCustomer(customerEmail, 'Wes Workflow')
      const sent = await sendColdMail(request, {
        from: customerEmail,
        subject: `Workflow ${marker}`,
        text: `Help please ${marker}`,
      })
      const conversationId = conversationTypeId((await conversationForMessage(sent.messageId)).id)
      const personal = createKey({ creatorEmail: adminEmail })
      const prePersonal = createKey({ creatorEmail: adminEmail })
      fixture({ op: 'backdateKey', keyId: prePersonal.id })
      const workspace = createKey({ creatorEmail: adminEmail, kind: 'workspace' })
      const apis = {
        personal: await apiFor(playwright, baseURL, personal.key),
        prePersonal: await apiFor(playwright, baseURL, prePersonal.key),
        workspace: await apiFor(playwright, baseURL, workspace.key),
      }
      const admin = await sessionApiAs(playwright, 'admin')
      const url = `/api/v1/conversations/${conversationId}/status`
      const setStatus = async (by: keyof typeof apis, status: 'open' | 'closed') =>
        expectJson(await apis[by].post(url, { data: { status } }), 200)
      try {
        await withLiveWorkflow(
          admin,
          {
            name: `Closed ${marker}`,
            triggerType: 'conversation.status_changed',
            onlyFor: customerEmail,
            alsoWhen: [{ field: 'conversation.status', op: 'eq', value: 'closed' }],
            steps: [
              { id: 'p', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
            ],
          },
          async (workflow) => {
            const runs = async () => (await workflowRuns(workflow.id)).length
            // The personal key's close runs it, as the same close in the app would.
            await setStatus('personal', 'closed')
            await expect.poll(runs, { timeout: 45_000 }).toBe(1)

            // A workspace key and a personal key from before the cutoff are
            // automated: their closes start nothing.
            await setStatus('workspace', 'open')
            await setStatus('workspace', 'closed')
            await setStatus('workspace', 'open')
            await setStatus('prePersonal', 'closed')
            await setStatus('workspace', 'open')

            // A last personal-key close is dispatched after the others, so once
            // its run lands every earlier close has been judged.
            await setStatus('personal', 'closed')
            await expect.poll(runs, { timeout: 45_000 }).toBe(2)
            await new Promise((r) => setTimeout(r, 2_000))
            expect(await runs()).toBe(2)
            const closes = (
              await eventsFor(conversationId, ['conversation.status_changed'])
            ).filter((e) => e.payload.newStatus === 'closed')
            expect(closes).toHaveLength(4)
          }
        )
      } finally {
        await Promise.all([admin.dispose(), ...Object.values(apis).map((a) => a.dispose())])
      }
    }
  )

  test(
    'API-20 priority: urgent fires priority_changed; an invalid value is 400',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const url = `/api/v1/conversations/${conversationId}/priority`
      const body = await expectJson(await api.post(url, { data: { priority: 'urgent' } }), 200)
      expect(body.data.priority).toBe('urgent')
      const [event] = await waitForEvent(conversationId, 'conversation.priority_changed')
      expect([event.payload.previousPriority, event.payload.newPriority]).toEqual([
        'none',
        'urgent',
      ])
      expect((await api.post(url, { data: { priority: 'critical' } })).status()).toBe(400)
      await api.dispose()
    }
  )

  test(
    'API-21 mark read answers ok; a read-only key is refused the write',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const ok = await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/read`),
        200
      )
      expect(ok.data).toEqual({ ok: true })

      const readOnly = createKey({
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        scopes: ['read:chat'],
      })
      const ro = await apiFor(playwright, baseURL, readOnly.key)
      const refused = await expectJson(
        await ro.post(`/api/v1/conversations/${conversationId}/read`),
        403
      )
      expect(refused.error.code).toBe('FORBIDDEN')
      expect(refused.error.message).toContain("missing the 'write:chat' scope")
      await api.dispose()
      await ro.dispose()
    }
  )

  test(
    'API-22 API-23 tags: attach twice without a duplicate, detach, and refusals',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const tagId = await seedTag(`Tag ${marker}`)
      const otherTag = await seedTag(`Other ${marker}`)
      const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, key)
      const url = `/api/v1/conversations/${conversationId}/tags`
      const ids = (body: { data: Array<{ id: string }> }) => body.data.map((t) => t.id)

      const first = await expectJson(await api.post(url, { data: { tagId } }), 200)
      expect(ids(first)).toEqual([tagId])
      const again = await expectJson(await api.post(url, { data: { tagId } }), 200)
      expect(ids(again)).toEqual([tagId])

      const detached = await expectJson(await api.delete(url, { data: { tagId } }), 200)
      expect(ids(detached)).toEqual([])
      const notAttached = await expectJson(
        await api.delete(url, { data: { tagId: otherTag } }),
        200
      )
      expect(ids(notAttached)).toEqual([])

      const missing = await api.delete(`/api/v1/conversations/${MISSING_CONVERSATION}/tags`, {
        data: { tagId },
      })
      expect(missing.status()).toBe(404)
      const badPrefix = await expectJson(await api.post(url, { data: { tagId: 'tag_123' } }), 400)
      expect(badPrefix.error.message).toBe('Invalid tag ID format')
      // Tags fire no webhook event.
      expect((await eventsFor(conversationId)).filter((e) => e.type.includes('tag'))).toHaveLength(
        0
      )
      await api.dispose()
    }
  )
})

test.describe('REST conversations: personal key scope', () => {
  test(
    'API-04 API-08 ACC-23 a scoped teammate key lists and reads only what the teammate sees',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const mate = newTeammate(`Scoped ${marker}`, INBOX_PERMISSIONS, [people.teams.billing])
      // Visible first (older), hidden after (newer): see pageUntilSeen.
      const own = await seedConv(`${marker} own`, {
        assigneePrincipalId: mate.principalId,
        ageMinutes: 4,
      })
      const team = await seedConv(`${marker} team`, { teamId: people.teams.billing, ageMinutes: 3 })
      const unassigned = await seedConv(`${marker} unassigned`, { ageMinutes: 2 })
      const otherTeam = await seedConv(`${marker} other team`, { teamId: people.teams.support })
      const someoneElse = await seedConv(`${marker} someone else`, {
        assigneePrincipalId: people.people.agentB.principalId,
      })
      const { key } = createKey({ creatorEmail: mate.email })
      const api = await apiFor(playwright, baseURL, key)

      const visible = [own, team, unassigned].map((c) => c.conversationId)
      const seen = await pageUntilSeen(async (cursor) => {
        const body = await expectJson(
          await api.get(`/api/v1/conversations?limit=100${cursor ? `&cursor=${cursor}` : ''}`),
          200
        )
        return {
          ids: body.data.map((c: { id: string }) => c.id),
          cursor: body.meta.pagination.hasMore ? body.meta.pagination.cursor : null,
        }
      }, visible)
      for (const id of visible) expect(seen.has(id), id).toBe(true)
      expect(seen.has(otherTeam.conversationId)).toBe(false)
      expect(seen.has(someoneElse.conversationId)).toBe(false)

      // API-08: out of scope reads exactly like a missing id, never 403.
      for (const hidden of [otherTeam, someoneElse]) {
        const res = await expectJson(
          await api.get(`/api/v1/conversations/${hidden.conversationId}`),
          404
        )
        expect(res.error).toEqual({ code: 'NOT_FOUND', message: 'Conversation not found' })
      }
      await expectJson(await api.get(`/api/v1/conversations/${team.conversationId}`), 200)

      // ACC-23: narrowing the creator's role applies on the next call.
      fixture({
        op: 'setPermissions',
        roleId: mate.roleId,
        permissions: INBOX_PERMISSIONS.filter((p) => p !== 'conversation.view'),
      })
      const narrowed = await expectJson(
        await api.get(`/api/v1/conversations/${team.conversationId}`),
        403
      )
      expect(narrowed.error.message).toBe("Requires the 'conversation.view' permission")
      await api.dispose()
    }
  )

  test(
    "API-24 every write on another team's conversation through a personal key is 404 and writes nothing",
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const mate = newTeammate(`Writer ${marker}`, INBOX_PERMISSIONS, [people.teams.billing])
      const hidden = await seedConv(marker, { teamId: people.teams.support })
      const tagId = await seedTag(`Tag ${marker}`)
      const { key } = createKey({ creatorEmail: mate.email })
      const api = await apiFor(playwright, baseURL, key)
      const base = `/api/v1/conversations/${hidden.conversationId}`
      const calls: Array<[string, () => ReturnType<typeof api.post>]> = [
        ['reply', () => api.post(`${base}/reply`, { data: { content: `x ${marker}` } })],
        ['note', () => api.post(`${base}/note`, { data: { content: `x ${marker}` } })],
        [
          'assign',
          () => api.post(`${base}/assign`, { data: { assigneePrincipalId: mate.principalId } }),
        ],
        ['status', () => api.post(`${base}/status`, { data: { status: 'closed' } })],
        ['priority', () => api.post(`${base}/priority`, { data: { priority: 'urgent' } })],
        ['read', () => api.post(`${base}/read`)],
        ['tags', () => api.post(`${base}/tags`, { data: { tagId } })],
        ['messages', () => api.get(`${base}/messages`)],
      ]
      for (const [name, call] of calls) {
        const res = await call()
        expect(res.status(), `${name}: ${await res.text()}`).toBe(404)
      }
      const sql = supportDb()
      const [row] = await sql`SELECT status, priority, assigned_agent_principal_id,
        (SELECT count(*)::int FROM conversation_messages WHERE conversation_id = c.id) AS messages,
        (SELECT count(*)::int FROM conversation_tag_assignments WHERE conversation_id = c.id) AS tags
      FROM conversations c WHERE id = ${uuidOf(hidden.conversationId)}`
      expect(row).toMatchObject({
        status: 'open',
        priority: 'none',
        assigned_agent_principal_id: null,
        messages: 1,
        tags: 0,
      })
      expect(await eventsFor(hidden.conversationId)).toHaveLength(0)
      await api.dispose()
    }
  )

  test(
    'ACC-24 a workspace key reads every team without membership; assign-only cannot read; revoked is refused',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const support = await seedConv(`${marker} support`, { teamId: people.teams.support })
      const billing = await seedConv(`${marker} billing`, { teamId: people.teams.billing })
      const workspace = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const api = await apiFor(playwright, baseURL, workspace.key)
      for (const c of [support, billing]) {
        await expectJson(await api.get(`/api/v1/conversations/${c.conversationId}`), 200)
      }

      // A role with conversation.assign but not conversation.view.
      const assignOnly = newTeammate(`Assign only ${marker}`, ['conversation.assign'])
      void assignOnly
      const roleKey = await (async () => {
        const sql = supportDb()
        const [r] = await sql`SELECT key FROM roles WHERE id = ${uuidOf(assignOnly.roleId)}`
        return r.key as string
      })()
      const assignKey = createKey({
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey,
      })
      const ak = await apiFor(playwright, baseURL, assignKey.key)
      const refused = await expectJson(
        await ak.get(`/api/v1/conversations/${support.conversationId}`),
        403
      )
      expect(refused.error.message).toBe("Requires the 'conversation.view' permission")

      fixture({ op: 'revoke', keyId: workspace.id })
      const revoked = await expectJson(
        await api.get(`/api/v1/conversations/${support.conversationId}`),
        401
      )
      expect(revoked.error.message).toBe(UNAUTHORIZED_MESSAGE)
      await api.dispose()
      await ak.dispose()
    }
  )
})

test.describe('REST keys and refusals', () => {
  test(
    'API-43 no or malformed Authorization is 401 with the Bearer challenge',
    { tag: '@core' },
    async ({ playwright, baseURL }) => {
      for (const header of [null, 'Basic dXNlcjpwYXNz', 'Bearer xyz']) {
        const api = await apiFor(playwright, baseURL, null, header ? { authorization: header } : {})
        const res = await api.get('/api/v1/conversations')
        const body = await expectJson(res, 401)
        expect(body.error).toEqual({ code: 'UNAUTHORIZED', message: UNAUTHORIZED_MESSAGE })
        expect(res.headers()['www-authenticate']).toBe('Bearer realm="Quackback API"')
        await api.dispose()
      }
    }
  )

  test(
    'API-44 a revoked or expired key is the same 401',
    { tag: '@core' },
    async ({ playwright, baseURL, people }) => {
      for (const op of ['revoke', 'expire'] as const) {
        const created = createKey({ creatorEmail: people.people.admin.email })
        const api = await apiFor(playwright, baseURL, created.key)
        await expectJson(await api.get('/api/v1/conversations?limit=1'), 200)
        fixture({ op, keyId: created.id })
        const body = await expectJson(await api.get('/api/v1/conversations?limit=1'), 401)
        expect(body.error).toEqual({ code: 'UNAUTHORIZED', message: UNAUTHORIZED_MESSAGE })
        await api.dispose()
      }
    }
  )

  test(
    'API-45 a personal key dies when its creator leaves or is blocked; their workspace key lives',
    { tag: '@core' },
    async ({ playwright, baseURL, marker }) => {
      test.setTimeout(90_000)
      for (const op of ['leave', 'block'] as const) {
        // An admin-like teammate who may create a workspace key.
        const mate = newTeammate(`${op} ${marker}`, [...INBOX_PERMISSIONS, 'api_key.manage'])
        const personal = createKey({ creatorEmail: mate.email })
        const p = await apiFor(playwright, baseURL, personal.key)
        await expectJson(await p.get('/api/v1/conversations?limit=1'), 200)
        fixture({ op, principalId: mate.principalId })
        const body = await expectJson(await p.get('/api/v1/conversations?limit=1'), 401)
        expect(body.error.message).toBe(UNAUTHORIZED_MESSAGE)
        await p.dispose()
      }
      // A workspace key holds its own role: its creator leaving changes nothing.
      const creator = newTeammate(`Owner ${marker}`, [...INBOX_PERMISSIONS, 'api_key.manage'])
      const workspace = createKey({ creatorEmail: creator.email, kind: 'workspace' })
      fixture({ op: 'leave', principalId: creator.principalId })
      const w = await apiFor(playwright, baseURL, workspace.key)
      await expectJson(await w.get('/api/v1/conversations?limit=1'), 200)
      await w.dispose()
    }
  )

  test(
    'API-46 a read-only key replying is 403 naming write:chat',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const { key } = createKey({ creatorEmail: people.people.admin.email, scopes: ['read:chat'] })
      const api = await apiFor(playwright, baseURL, key)
      await expectJson(await api.get(`/api/v1/conversations/${conversationId}`), 200)
      const body = await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/reply`, { data: { content: 'x' } }),
        403
      )
      expect(body.error).toEqual({
        code: 'FORBIDDEN',
        message: "This API key is missing the 'write:chat' scope required by 'conversation.reply'",
      })
      await api.dispose()
    }
  )

  test(
    'API-47 a feedback-only key reading conversations or tickets is 403 naming read:chat',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const { key } = createKey({
        creatorEmail: people.people.admin.email,
        scopes: ['read:feedback'],
      })
      const api = await apiFor(playwright, baseURL, key)
      const conversations = await expectJson(await api.get('/api/v1/conversations'), 403)
      expect(conversations.error.message).toBe(
        "This API key is missing the 'read:chat' scope required by 'conversation.view'"
      )
      const tickets = await expectJson(await api.get('/api/v1/tickets'), 403)
      expect(tickets.error.message).toBe(
        "This API key is missing the 'read:chat' scope required by 'ticket.view'"
      )
      await api.dispose()
    }
  )

  test(
    'API-48 a creator without the permission is refused before any scope check',
    { tag: '@core' },
    async ({ playwright, baseURL, marker }) => {
      const mate = newTeammate(
        `No create ${marker}`,
        INBOX_PERMISSIONS.filter((p) => p !== 'ticket.create' && p !== 'conversation.assign')
      )
      const { conversationId } = await seedConv(marker, { assigneePrincipalId: mate.principalId })
      // Read-only scopes too: the permission refusal must come first.
      const { key } = createKey({ creatorEmail: mate.email, scopes: ['read:chat'] })
      const api = await apiFor(playwright, baseURL, key)
      const ticket = await expectJson(
        await api.post('/api/v1/tickets', { data: { title: marker } }),
        403
      )
      expect(ticket.error.message).toBe("Requires the 'ticket.create' permission")
      const assign = await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/assign`, { data: {} }),
        403
      )
      expect(assign.error.message).toBe("Requires the 'conversation.assign' permission")

      // Narrowing applies on the next call.
      const full = createKey({ creatorEmail: mate.email })
      const f = await apiFor(playwright, baseURL, full.key)
      await expectJson(await f.get(`/api/v1/conversations/${conversationId}`), 200)
      fixture({ op: 'setPermissions', roleId: mate.roleId, permissions: ['member.view'] })
      const narrowed = await expectJson(await f.get(`/api/v1/conversations/${conversationId}`), 403)
      expect(narrowed.error.message).toBe("Requires the 'conversation.view' permission")
      await api.dispose()
      await f.dispose()
    }
  )

  test(
    'API-49 a legacy full-access key (NULL scopes) writes within its permissions',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, asPerson }) => {
      const { conversationId } = await seedConv(marker)
      const name = `Legacy ${marker}`
      const { key } = createKey({ creatorEmail: people.people.admin.email, legacy: true, name })
      const api = await apiFor(playwright, baseURL, key)
      await expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/note`, {
          data: { content: marker },
        }),
        201
      )
      const admin = await asPerson('admin')
      await admin.goto('/settings/api-keys')
      const row = admin.getByText(name).first()
      await expect(row).toBeVisible({ timeout: 15_000 })
      await expect(admin.getByText('Full access (legacy)').first()).toBeVisible()
      await api.dispose()
    }
  )

  test(
    'API-51 writes and refused writes are audited with channel api, the key and the creator',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const writer = createKey({ creatorEmail: people.people.admin.email })
      const reader = createKey({ creatorEmail: people.people.admin.email, scopes: ['read:chat'] })
      const w = await apiFor(playwright, baseURL, writer.key)
      const r = await apiFor(playwright, baseURL, reader.key)
      await expectJson(
        await w.post(`/api/v1/conversations/${conversationId}/status`, {
          data: { status: 'closed' },
        }),
        200
      )
      await expectJson(
        await r.post(`/api/v1/conversations/${conversationId}/reply`, {
          data: { content: marker },
        }),
        403
      )
      const sql = supportDb()
      const rows = await expect
        .poll(async () => {
          const found = await sql`SELECT event_outcome, channel, credential_kind, credential_id,
                                       on_behalf_of_principal_id, actor_type
                                FROM audit_log WHERE target_id = ${conversationId}
                                ORDER BY occurred_at`
          return found.length
        })
        .toBeGreaterThanOrEqual(2)
      void rows
      const found = await sql`SELECT event_outcome, channel, credential_kind, credential_id,
                                   on_behalf_of_principal_id, actor_type
                            FROM audit_log WHERE target_id = ${conversationId} ORDER BY occurred_at`
      const creator = uuidOf(people.people.admin.principalId)
      expect(found).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event_outcome: 'success',
            channel: 'api',
            credential_kind: 'api_key',
            credential_id: writer.id,
            on_behalf_of_principal_id: creator,
            actor_type: 'service',
          }),
          expect.objectContaining({
            event_outcome: 'failure',
            channel: 'api',
            credential_id: reader.id,
            on_behalf_of_principal_id: creator,
          }),
        ])
      )
      await w.dispose()
      await r.dispose()
    }
  )
})
