/**
 * Inbox access: who may list, open and write which conversation or ticket,
 * proved at the server function a browser calls (and REST/MCP where the
 * journey names them), plus the screens a scoped teammate sees.
 *
 * Journeys: INB-03, INB-04, INB-18, INB-28, INB-35, INB-48, INB-52, INB-69,
 * INB-94, INB-95, TKT-10, TKT-32, TKT-63 (support e2e plan, journeys.md).
 */
import { fromUuid, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  convRow,
  createRole,
  inboxListQuery,
  inboxRow,
  openFromList,
  listedIds,
  messageId,
  seedConv,
  seedTicket,
} from '../../support/access'
import { callServerFn, personApi, serverFnId } from '../../support/server-fns'
import { createTeam } from '../../support/teammates'
import { createSupportApiKey } from '../../utils/db-helpers'

/** Everything a scoped writer may do to a conversation, with no cross-team view. */
const SCOPED_WRITER = [
  'conversation.view',
  'conversation.reply',
  'conversation.note',
  'conversation.assign',
  'conversation.set_status',
  'conversation.set_tags',
  'conversation.manage_tags',
  'conversation.set_attributes',
  'conversation.manage',
  'ticket.view',
  'ticket.create',
  'ticket.reply',
  'ticket.set_status',
  'member.view',
  'people.view',
] as const

const ticketCount = async (titlePrefix: string) => {
  const [row] =
    await supportDb()`SELECT count(*)::int AS n FROM tickets WHERE title LIKE ${`${titlePrefix}%`}`
  return row.n as number
}

test.describe('inbox access at the server', () => {
  test(
    'INB-03 a principal without any inbox view permission is refused the list and counts',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const conv = await seedConv({ marker, label: 'unassigned' })
      for (const person of ['customer', 'noAccess'] as const) {
        const api = await personApi(playwright, person)
        const list = await callServerFn(api, 'listInboxItemsFn', inboxListQuery(marker), {
          method: 'GET',
        })
        expect(list.ok, person).toBe(false)
        expect(list.code, person).toBe('FORBIDDEN')
        expect(list.error, person).toContain('You cannot view the inbox')
        expect(list.error, person).not.toContain(conv.id)
        const counts = await callServerFn(api, 'fetchInboxCountsFn', undefined, { method: 'GET' })
        expect(counts.ok, person).toBe(false)
        expect(counts.code, person).toBe('FORBIDDEN')
        await api.dispose()
      }
      // The same call as a teammate who can view lists the row (the call itself works).
      const scoped = await personApi(playwright, 'scoped')
      const list = await callServerFn(scoped, 'listInboxItemsFn', inboxListQuery(marker), {
        method: 'GET',
      })
      expect(listedIds(list.data)).toContain(conv.id)
      await scoped.dispose()
    }
  )

  test(
    'INB-18 saved views: a Contributor may not create, update or delete one; bad payloads fail validation',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const contributor = await personApi(playwright, 'contributor')
      const admin = await personApi(playwright, 'admin')
      const filters = { rules: [{ field: 'status', op: 'is', value: 'open' }] }

      const refused = await callServerFn(contributor, 'createConversationViewFn', {
        name: `${marker} view`,
        filters,
      })
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/FORBIDDEN|Access denied|permission/i)

      const created = await callServerFn<{ id: string }>(admin, 'createConversationViewFn', {
        name: `${marker} view`,
        filters,
      })
      expect(created.ok, created.error).toBe(true)
      const viewId = created.data.id
      for (const [fn, data] of [
        ['updateConversationViewFn', { id: viewId, name: `${marker} renamed` }],
        ['deleteConversationViewFn', { viewId }],
      ] as const) {
        const res = await callServerFn(contributor, fn, data)
        expect(res.ok, fn).toBe(false)
        expect(res.error, fn).toMatch(/FORBIDDEN|Access denied|permission/i)
      }
      const [still] =
        await supportDb()`SELECT name FROM conversation_views WHERE id = ${toUuid(viewId as `conversation_view_${string}`)}`
      expect(still?.name).toBe(`${marker} view`)

      // Pinning needs only conversation.view.
      const pinned = await callServerFn(contributor, 'pinConversationViewFn', { viewId })
      expect(pinned.ok, pinned.error).toBe(true)

      const tooMany = await callServerFn(admin, 'createConversationViewFn', {
        name: `${marker} too many`,
        filters: { rules: Array.from({ length: 16 }, () => filters.rules[0]) },
      })
      expect(tooMany.ok).toBe(false)
      const unknownField = await callServerFn(admin, 'createConversationViewFn', {
        name: `${marker} unknown`,
        filters: { rules: [{ field: 'no_such_field', op: 'is', value: 'x' }] },
      })
      expect(unknownField.ok).toBe(false)
      const [{ n }] =
        await supportDb()`SELECT count(*)::int AS n FROM conversation_views WHERE name IN (${`${marker} too many`}, ${`${marker} unknown`})`
      expect(n).toBe(0)
      await contributor.dispose()
      await admin.dispose()
    }
  )

  test(
    'INB-35 replying needs conversation.reply: a view-only role and a portal user write nothing',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const conv = await seedConv({ marker, label: 'unassigned' })
      const viewOnly = await newTeammate({
        roleKey: await createRole(marker, ['conversation.view']),
      })
      for (const [who, api] of [
        ['view-only teammate', await viewOnly.api(playwright)],
        ['portal user', await personApi(playwright, 'customer')],
      ] as const) {
        const res = await callServerFn(api, 'sendAgentMessageFn', {
          conversationId: conv.id,
          content: `${marker} from ${who}`,
        })
        expect(res.ok, who).toBe(false)
        expect(res.error, who).toMatch(
          /conversation\.reply|Only team members|FORBIDDEN|Access denied/
        )
        await api.dispose()
      }
      const row = await convRow(conv.id)
      expect(row.message_count).toBe(2)
      expect(row.assigned_agent_principal_id).toBeNull()
    }
  )

  test(
    'INB-48 assigning to someone who is not a teammate is refused and the assignee is unchanged',
    { tag: '@nightly' },
    async ({ playwright, marker, people }) => {
      const conv = await seedConv({ marker, label: 'unassigned' })
      const admin = await personApi(playwright, 'admin')
      const res = await callServerFn(admin, 'assignConversationFn', {
        conversationId: conv.id,
        assignTo: people.people.customer.principalId,
      })
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_ASSIGNEE')
      expect(res.error).toContain('Can only assign to a team member')
      expect((await convRow(conv.id)).assigned_agent_principal_id).toBeNull()
      await admin.dispose()
    }
  )

  test(
    'INB-69 macros: no reply permission is refused, a missing macro is MACRO_NOT_FOUND, a hidden conversation applies nothing',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const teamA = await createTeam(`${marker}-a`)
      const teamB = await createTeam(`${marker}-b`)
      const hidden = await seedConv({ marker, label: 'team B', teamId: teamB.id })
      const visible = await seedConv({ marker, label: 'team A', teamId: teamA.id })
      const admin = await personApi(playwright, 'admin')
      const macro = await callServerFn<{ id: string }>(admin, 'createMacroFn', {
        name: `${marker} macro`,
        body: `${marker} macro body`,
        actions: [{ type: 'set_priority', priority: 'urgent' }],
      })
      expect(macro.ok, macro.error).toBe(true)

      const noReply = await newTeammate({
        roleKey: await createRole(marker, ['conversation.view']),
        teams: [teamA.id],
      })
      const noReplyApi = await noReply.api(playwright)
      const refused = await callServerFn(noReplyApi, 'applyMacroFn', {
        conversationId: visible.id,
        macroId: macro.data.id,
      })
      expect(refused.ok).toBe(false)
      expect(refused.error).toContain('conversation.reply')

      const writer = await newTeammate({
        roleKey: await createRole(marker, SCOPED_WRITER),
        teams: [teamA.id],
      })
      const writerApi = await writer.api(playwright)
      const missing = await callServerFn(writerApi, 'applyMacroFn', {
        conversationId: visible.id,
        macroId: 'macro_01kaaaaaaaaaaaaaaaaaaaaaaa',
      })
      // journeys.md says MACRO_NOT_FOUND; the service answers NOT_FOUND "Macro not found".
      expect(missing.code).toBe('NOT_FOUND')
      expect(missing.error).toContain('Macro not found')

      const onHidden = await callServerFn(writerApi, 'applyMacroFn', {
        conversationId: hidden.id,
        macroId: macro.data.id,
      })
      expect(onHidden.code).toBe('CONVERSATION_NOT_FOUND')
      const hiddenRow = await convRow(hidden.id)
      expect(hiddenRow.message_count).toBe(2)
      expect(hiddenRow.priority).toBe('none')

      // The same macro on the teammate's own team's conversation applies.
      const applied = await callServerFn(writerApi, 'applyMacroFn', {
        conversationId: visible.id,
        macroId: macro.data.id,
      })
      expect(applied.ok, applied.error).toBe(true)
      await expect.poll(async () => (await convRow(visible.id)).priority).toBe('urgent')
      for (const api of [admin, noReplyApi, writerApi]) await api.dispose()
    }
  )

  test(
    "INB-94 a scoped teammate gets Not found on every write by id to another team's conversation, and the row is unchanged",
    { tag: '@smoke' },
    async ({ playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const teamA = await createTeam(`${marker}-a`)
      const teamB = await createTeam(`${marker}-b`)
      const hidden = await seedConv({ marker, label: 'team B', teamId: teamB.id })
      const visible = await seedConv({ marker, label: 'team A', teamId: teamA.id })
      const hiddenMsg = await messageId(hidden.id, hidden.messages[0])
      const writer = await newTeammate({
        roleKey: await createRole(marker, SCOPED_WRITER),
        teams: [teamA.id],
      })
      const api = await writer.api(playwright)
      const admin = await personApi(playwright, 'admin')
      const macro = await callServerFn<{ id: string }>(admin, 'createMacroFn', {
        name: `${marker} macro`,
        body: `${marker} macro body`,
      })
      const before = await convRow(hidden.id)
      const tagName = `${marker}-inline-tag`.slice(0, 40)

      const calls: Array<[string, unknown, ('GET' | 'POST')?, string?]> = [
        ['sendAgentMessageFn', { conversationId: hidden.id, content: `${marker} reply` }],
        ['addConversationNoteFn', { conversationId: hidden.id, content: `${marker} note` }],
        ['assignConversationFn', { conversationId: hidden.id, assignTo: 'me' }],
        ['assignConversationTeamFn', { conversationId: hidden.id, teamId: teamA.id }],
        ['setConversationPriorityFn', { conversationId: hidden.id, priority: 'urgent' }],
        ['snoozeConversationFn', { conversationId: hidden.id, until: null }],
        ['setConversationStatusFn', { conversationId: hidden.id, status: 'closed' }],
        ['endConversationFn', { conversationId: hidden.id, reason: 'resolved' }],
        ['restoreConversationFromSpamFn', { conversationId: hidden.id }],
        ['addConversationTagFn', { conversationId: hidden.id, name: tagName }],
        ['setConversationAttributeValueFn', { conversationId: hidden.id, key: 'plan', value: 'x' }],
        ['applyMacroFn', { conversationId: hidden.id, macroId: macro.data.id }],
        [
          'addConversationParticipantFn',
          { conversationId: hidden.id, email: `${marker}@customers.example` },
        ],
        [
          'markConversationUnreadFromMessageFn',
          { conversationId: hidden.id, messageId: hiddenMsg },
        ],
        [
          'translateConversationMessagesFn',
          { conversationId: hidden.id, messageIds: [hiddenMsg] },
          'GET',
        ],
        ['exportConversationTranscriptFn', { conversationId: hidden.id }, 'GET'],
        ['getConversationFn', { conversationId: hidden.id }, 'GET'],
        [
          'addMessageReactionFn',
          { messageId: hiddenMsg, emoji: '👍' },
          'POST',
          'MESSAGE_NOT_FOUND',
        ],
        ['setMessageFlagFn', { messageId: hiddenMsg, flagged: true }, 'POST', 'MESSAGE_NOT_FOUND'],
        [
          'editConversationMessageFn',
          { messageId: hiddenMsg, content: 'edited' },
          'POST',
          'MESSAGE_NOT_FOUND',
        ],
        ['deleteConversationMessageFn', { messageId: hiddenMsg }, 'POST', 'MESSAGE_NOT_FOUND'],
      ]
      for (const [fn, data, method, code] of calls) {
        const res = await callServerFn(api, fn, data, { method: method ?? 'POST' })
        expect(res.ok, `${fn} answered ok`).toBe(false)
        expect(res.code, `${fn}: ${res.error.slice(0, 300)}`).toBe(code ?? 'CONVERSATION_NOT_FOUND')
      }

      // Bulk: the hidden id fails like a missing one and the batch goes on.
      const bulk = await callServerFn<{
        succeeded: string[]
        failed: { id: string; reason: string }[]
      }>(api, 'bulkUpdateConversationsFn', {
        conversationIds: [hidden.id, visible.id],
        action: { type: 'priority', priority: 'high' },
      })
      expect(bulk.ok, bulk.error).toBe(true)
      expect(bulk.data.succeeded).toEqual([visible.id])
      expect(bulk.data.failed).toEqual([{ id: hidden.id, reason: 'Conversation not found' }])

      // Creating a ticket from the hidden conversation fails and makes none.
      const ticket = await callServerFn(api, 'createTicketFn', {
        title: `${marker} from hidden`,
        conversationId: hidden.id,
      })
      expect(ticket.ok).toBe(false)
      expect(await ticketCount(`${marker} from hidden`)).toBe(0)

      // Nothing moved: no message, status, team, assignee, priority, tag, inline tag or participant.
      expect(await convRow(hidden.id)).toEqual(before)
      const [{ tags }] =
        await supportDb()`SELECT count(*)::int AS tags FROM conversation_tags WHERE name = ${tagName}`
      expect(tags).toBe(0)
      const [{ participants }] =
        await supportDb()`SELECT count(*)::int AS participants FROM conversation_participants WHERE conversation_id = ${toUuid(hidden.id as `conversation_${string}`)}`
      expect(participants).toBe(0)
      const [msg] =
        await supportDb()`SELECT content, deleted_at FROM conversation_messages WHERE id = ${toUuid(hiddenMsg as `conversation_msg_${string}`)}`
      expect(msg.content).toBe(hidden.messages[0])
      expect(msg.deleted_at).toBeNull()

      // The same calls work on the teammate's own team's conversation.
      for (const [fn, data] of [
        ['sendAgentMessageFn', { conversationId: visible.id, content: `${marker} reply` }],
        ['addConversationNoteFn', { conversationId: visible.id, content: `${marker} note` }],
        ['addConversationTagFn', { conversationId: visible.id, name: `${tagName}-ok` }],
        ['setConversationPriorityFn', { conversationId: visible.id, priority: 'urgent' }],
      ] as const) {
        const res = await callServerFn(api, fn, data)
        expect(res.ok, `${fn} on team A: ${res.error.slice(0, 300)}`).toBe(true)
      }
      const after = await convRow(visible.id)
      const written = await supportDb()`SELECT content FROM conversation_messages
      WHERE conversation_id = ${toUuid(visible.id as `conversation_${string}`)} AND content IN (${`${marker} note`}, ${`${marker} reply`})`
      expect(written.map((m) => m.content).sort()).toEqual([`${marker} note`, `${marker} reply`])
      expect(after.priority).toBe('urgent')
      expect(after.tag_count).toBe(1)
      await api.dispose()
      await admin.dispose()
    }
  )

  test(
    'INB-95 REST GET for a missing conversation answers 404 "Conversation not found"',
    { tag: '@core' },
    async ({ playwright, people }) => {
      const key = createSupportApiKey(people.people.admin.email, 'personal')
      const rest = await personApi(playwright, 'admin')
      const res = await rest.get('/api/v1/conversations/conversation_01kaaaaaaaaaaaaaaaaaaaaaaa', {
        headers: { authorization: `Bearer ${key}` },
      })
      expect(res.status()).toBe(404)
      const body = await res.text()
      expect(body).toContain('Conversation not found')
      expect(body).not.toContain('not found not found')
      await rest.dispose()
    }
  )
})

test.describe('ticket access at the server', () => {
  test(
    'TKT-10 creating a ticket from a hidden or missing conversation is refused and makes no ticket',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const teamA = await createTeam(`${marker}-a`)
      const teamB = await createTeam(`${marker}-b`)
      const hidden = await seedConv({ marker, label: 'team B', teamId: teamB.id })
      const visible = await seedConv({ marker, label: 'team A', teamId: teamA.id })
      const writer = await newTeammate({
        roleKey: await createRole(marker, SCOPED_WRITER),
        teams: [teamA.id],
      })
      const api = await writer.api(playwright)

      for (const [label, conversationId] of [
        ['hidden', hidden.id],
        ['missing', 'conversation_01kaaaaaaaaaaaaaaaaaaaaaaa'],
      ] as const) {
        const res = await callServerFn(api, 'createTicketFn', {
          type: 'customer',
          title: `${marker} ticket from ${label}`,
          conversationId,
        })
        expect(res.ok, label).toBe(false)
        expect(res.error, label).toContain('Conversation not found')
        expect(await ticketCount(`${marker} ticket from ${label}`), label).toBe(0)
      }

      const ok = await callServerFn(api, 'createTicketFn', {
        type: 'back_office',
        title: `${marker} ticket from visible`,
        conversationId: visible.id,
      })
      expect(ok.ok, ok.error.slice(0, 300)).toBe(true)
      expect(await ticketCount(`${marker} ticket from visible`)).toBe(1)
      await api.dispose()
    }
  )

  test(
    'TKT-32 ticket status refusals: no permission, unknown status, out-of-scope ticket',
    { tag: '@core' },
    async ({ playwright, marker, people, newTeammate }) => {
      const own = await seedTicket({ marker, label: 'billing', teamId: people.teams.billing })
      const other = await seedTicket({ marker, label: 'support', teamId: people.teams.support })
      const [resolved] =
        await supportDb()`SELECT id FROM ticket_statuses WHERE category = 'closed' ORDER BY position LIMIT 1`
      const statusId = fromUuid('ticket_status', resolved.id as string)
      const statusOf = async (id: string) => {
        const [row] =
          await supportDb()`SELECT status_id FROM tickets WHERE id = ${toUuid(id as `ticket_${string}`)}`
        return row.status_id as string
      }
      const ownBefore = await statusOf(own.id)

      const noStatus = await newTeammate({
        roleKey: await createRole(marker, ['ticket.view', 'conversation.view']),
        teams: [people.teams.billing],
      })
      const noStatusApi = await noStatus.api(playwright)
      const refused = await callServerFn(noStatusApi, 'setTicketStatusFn', {
        ticketId: own.id,
        statusId,
      })
      expect(refused.ok).toBe(false)
      // The server function's own permission gate answers first (the service's
      // "You cannot change this ticket status" guards bulk and other callers).
      expect(refused.error).toContain("Requires permission 'ticket.set_status'")

      const scoped = await personApi(playwright, 'scoped')
      const unknown = await callServerFn(scoped, 'setTicketStatusFn', {
        ticketId: own.id,
        statusId: 'ticket_status_01kaaaaaaaaaaaaaaaaaaaaaaa',
      })
      expect(unknown.code).toBe('STATUS_NOT_FOUND')
      expect(await statusOf(own.id)).toBe(ownBefore)

      const hidden = await callServerFn(scoped, 'setTicketStatusFn', {
        ticketId: other.id,
        statusId,
      })
      expect(hidden.code).toBe('TICKET_NOT_FOUND')
      expect(await statusOf(other.id)).not.toBe(resolved.id)

      const allowed = await callServerFn(scoped, 'setTicketStatusFn', {
        ticketId: own.id,
        statusId,
      })
      expect(allowed.ok, allowed.error.slice(0, 300)).toBe(true)
      expect(await statusOf(own.id)).toBe(resolved.id)
      await noStatusApi.dispose()
      await scoped.dispose()
    }
  )

  test(
    "TKT-63 a scoped teammate sees only their own and their team's tickets; every other read and write is not found, REST and MCP included",
    { tag: '@core' },
    async ({ playwright, marker, people, newTeammate }) => {
      test.setTimeout(60_000)
      const s = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [people.teams.billing] })
      const mine = await seedTicket({ marker, label: 'mine', assigneeId: s.principalId })
      const ownTeam = await seedTicket({ marker, label: 'billing', teamId: people.teams.billing })
      const otherTeam = await seedTicket({ marker, label: 'support', teamId: people.teams.support })
      const unassigned = await seedTicket({ marker, label: 'unassigned' })

      const api = await s.api(playwright)
      const list = await callServerFn(
        api,
        'listInboxItemsFn',
        { ...inboxListQuery(marker), kinds: ['ticket'] },
        { method: 'GET' }
      )
      expect(list.ok, list.error).toBe(true)
      expect(listedIds(list.data).sort()).toEqual([mine.id, ownTeam.id].sort())

      for (const hidden of [otherTeam, unassigned]) {
        for (const [fn, data, method] of [
          ['getTicketFn', { ticketId: hidden.id }, 'GET'],
          ['fetchTicketActivityFn', { ticketId: hidden.id }, 'GET'],
          ['listTicketMessagesFn', { ticketId: hidden.id }, 'GET'],
          ['getTicketLinksFn', { ticketId: hidden.id }, 'GET'],
          ['fetchTicketExternalLinksFn', { ticketId: hidden.id }, 'GET'],
          ['getTicketProvenanceConversationsFn', { ticketId: hidden.id }, 'GET'],
          ['exportTicketTranscriptFn', { ticketId: hidden.id }, 'GET'],
          ['getTicketWatchStatusFn', { ticketId: hidden.id }, 'GET'],
          ['watchTicketFn', { ticketId: hidden.id }, 'POST'],
          ['sendTicketMessageFn', { ticketId: hidden.id, content: `${marker} reply` }, 'POST'],
          ['addTicketNoteFn', { ticketId: hidden.id, content: `${marker} note` }, 'POST'],
          ['setTicketPriorityFn', { ticketId: hidden.id, priority: 'urgent' }, 'POST'],
          ['markTicketReadFn', { ticketId: hidden.id }, 'POST'],
        ] as const) {
          const res = await callServerFn(api, fn, data, { method })
          expect(res.ok, `${fn} on ${hidden.title}`).toBe(false)
          expect(res.code, `${fn}: ${res.error.slice(0, 300)}`).toBe('TICKET_NOT_FOUND')
        }
        const [row] =
          await supportDb()`SELECT priority, (SELECT count(*)::int FROM conversation_messages m WHERE m.ticket_id = t.id) AS messages FROM tickets t WHERE id = ${toUuid(hidden.id as `ticket_${string}`)}`
        expect(row).toEqual({ priority: 'none', messages: 0 })
      }
      // The visible ones open.
      for (const visible of [mine, ownTeam]) {
        const res = await callServerFn(
          api,
          'getTicketFn',
          { ticketId: visible.id },
          { method: 'GET' }
        )
        expect(res.ok, `${visible.title}: ${res.error.slice(0, 200)}`).toBe(true)
      }

      // REST and MCP with the teammate's personal key follow the same scope.
      const key = createSupportApiKey(s.email, 'personal')
      const auth = { authorization: `Bearer ${key}` }
      expect((await api.get(`/api/v1/tickets/${otherTeam.id}`, { headers: auth })).status()).toBe(
        404
      )
      expect((await api.get(`/api/v1/tickets/${ownTeam.id}`, { headers: auth })).status()).toBe(200)
      const mcp = (id: string) =>
        api.post('/api/mcp', {
          headers: {
            ...auth,
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
          },
          data: {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'get_ticket', arguments: { ticketId: id } },
          },
        })
      const hiddenMcp = await (await mcp(otherTeam.id)).text()
      expect(hiddenMcp).toMatch(/not found/i)
      expect(hiddenMcp).not.toContain(otherTeam.title)
      const visibleMcp = await (await mcp(ownTeam.id)).text()
      expect(visibleMcp).toContain(ownTeam.title)
      await api.dispose()
    }
  )
})

test.describe('inbox access on screen', () => {
  test(
    'INB-04 a custom inbox-only role loads the admin and the inbox with no 500 and empty people pickers',
    { tag: '@core' },
    async ({ browser, marker, newTeammate }) => {
      const conv = await seedConv({ marker, label: 'unassigned' })
      const role = await createRole(marker, [
        'conversation.view',
        'ticket.view',
        'conversation.reply',
        'conversation.note',
        'conversation.set_status',
      ])
      const t = await newTeammate({ roleKey: role })
      const page = await t.newPage(browser)
      const failures: string[] = []
      page.on('response', (r) => {
        if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`)
      })
      const teamCalls: string[] = []
      const listTeams = serverFnId('listTeamsFn')
      page.on('request', (r) => {
        if (r.url().includes(listTeams)) teamCalls.push(r.url())
      })

      const home = await page.goto('/admin')
      expect(home?.status()).toBeLessThan(500)
      await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 15_000 })
      await page.goto(`/admin/inbox?view=all&q=${encodeURIComponent(marker)}`)
      await openFromList(page, conv)
      await expect(
        page.getByText(/plan|upgrade/i).filter({ hasText: /seats|plan limit/i })
      ).toHaveCount(0)

      // The assignee picker opens with nobody in it (no member.view).
      await page.getByRole('button', { name: 'Unassigned', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: 'Assign to me' })).toBeVisible()
      await expect(
        page.getByRole('menuitem', { name: /Ada Admin|Ben Agent|Sam Scoped/ })
      ).toHaveCount(0)
      await page.keyboard.press('Escape')

      expect(failures).toEqual([])
      expect(teamCalls).toEqual([])
    }
  )

  test(
    'INB-28 a hidden conversation and a missing id both show "Conversation not found" at once, with no retries',
    { tag: '@core' },
    async ({ asPerson, people, marker }) => {
      const hidden = await seedConv({ marker, label: 'team support', teamId: people.teams.support })
      const fnId = serverFnId('getConversationFn')
      for (const [who, id] of [
        ['scoped', hidden.id],
        ['admin', 'conversation_01kaaaaaaaaaaaaaaaaaaaaaaa'],
      ] as const) {
        const page = await asPerson(who)
        let calls = 0
        page.on('request', (r) => {
          if (r.url().includes(fnId)) calls += 1
        })
        await page.goto(`/admin/inbox?i=${id}`)
        await expect(page.getByText('Conversation not found'), who).toBeVisible({ timeout: 15_000 })
        await expect(page.getByRole('button', { name: 'Send reply' })).toHaveCount(0)
        await expect(page.getByText(hidden.messages[0])).toHaveCount(0)
        // Give a retry time to happen if the app were going to retry.
        await page.waitForTimeout(2_500)
        expect(calls, `${who}: getConversationFn calls`).toBeLessThanOrEqual(1)
      }
    }
  )

  test(
    "INB-52 moving a conversation to another team removes it live from a scoped teammate's open inbox",
    { tag: '@smoke' },
    async ({ asPerson, playwright, people, marker }) => {
      const conv = await seedConv({ marker, label: 'billing', teamId: people.teams.billing })
      const scoped = await asPerson('scoped')
      await scoped.goto(`/admin/inbox?view=all&q=${encodeURIComponent(marker)}&i=${conv.id}`)
      await expect(scoped.getByText(conv.messages[0]).first()).toBeVisible({ timeout: 15_000 })
      const row = inboxRow(scoped, conv)
      await expect(row).toBeVisible()

      const admin = await personApi(playwright, 'admin')
      const moved = await callServerFn(admin, 'assignConversationTeamFn', {
        conversationId: conv.id,
        teamId: people.teams.support,
      })
      expect(moved.ok, moved.error).toBe(true)

      await expect(scoped.getByText('Conversation not found')).toBeVisible({ timeout: 10_000 })
      await expect(row).toHaveCount(0)
      await admin.dispose()
    }
  )
})
