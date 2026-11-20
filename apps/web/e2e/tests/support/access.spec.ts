/**
 * Team access end to end: which conversations and tickets each teammate
 * lists, opens by URL, streams, acts on and hears about.
 *
 * The Unassigned queue (no assignee, no team) is open to everyone with
 * conversation.view; an unassigned ticket is not. A teammate without the
 * workspace-wide view sees their own items, their teams' items and that queue.
 *
 * Journeys: ACC-02..08, ACC-13..17, ACC-27, ACC-29. The new-message half of
 * ACC-14 and RT-48 need control of who is online: access.serial.spec.ts.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import {
  convRow,
  createRole,
  inboxListQuery,
  inboxRow,
  listedIds,
  messageId,
  openFromList,
  seedConv,
  seedTicket,
  turnOnFlag,
  type SeededConv,
} from '../../support/access'
import { bellsFor, mentionDoc } from '../../support/access-bells'
import { callServerFn, personApi } from '../../support/server-fns'
import { openStream } from '../../support/streams'
import { createTeam } from '../../support/teammates'
import { createSupportApiKey } from '../../utils/db-helpers'
import type { Page } from '@playwright/test'

/** Write permissions without the workspace-wide view. */
const SCOPED_WRITER = [
  'conversation.view',
  'conversation.reply',
  'conversation.note',
  'conversation.assign',
  'conversation.set_status',
  'conversation.set_tags',
  'conversation.manage_tags',
  'conversation.set_attributes',
  'ticket.view',
  'ticket.create',
  'ticket.reply',
  'ticket.note',
  'ticket.set_status',
  'member.view',
] as const

async function searchInbox(page: Page, marker: string, extra = ''): Promise<void> {
  await page.goto(`/admin/inbox?view=all&status=all&q=${encodeURIComponent(marker)}${extra}`)
}

async function expectListed(page: Page, shown: SeededConv[], hidden: SeededConv[]): Promise<void> {
  for (const conv of shown)
    await expect(inboxRow(page, conv), conv.subject).toBeVisible({ timeout: 15_000 })
  // The list arrives in one answer, so once the shown rows are there a hidden
  // one would be too.
  for (const conv of hidden) await expect(inboxRow(page, conv), conv.subject).toHaveCount(0)
}

test.describe('lists', () => {
  test(
    'ACC-02 a view-all teammate lists conversations of every team, assigned to anyone, and unassigned',
    { tag: '@core' },
    async ({ browser, people, marker, newTeammate }) => {
      const convs = [
        await seedConv({ marker, label: 'support team', teamId: people.teams.support }),
        await seedConv({ marker, label: 'billing team', teamId: people.teams.billing }),
        await seedConv({
          marker,
          label: 'scoped teammate',
          assigneeId: people.people.scoped.principalId,
          agentReply: true,
        }),
        await seedConv({ marker, label: 'unassigned' }),
      ]
      // A Support lead on team Support only, who still sees everything. (A
      // teammate of this test's own: the inbox page marks its viewer online,
      // and the harness's presence checks read the shared people.)
      const lead = await newTeammate({ roleKey: 'support_lead', teams: [people.teams.support] })
      const page = await lead.newPage(browser)
      await searchInbox(page, marker)
      await expectListed(page, convs, [])
    }
  )

  test(
    "ACC-03 a scoped teammate lists their own, their team's and the Unassigned queue, never another team's",
    { tag: '@smoke' },
    async ({ asPerson, playwright, people, marker }) => {
      const mine = await seedConv({
        marker,
        label: 'mine',
        assigneeId: people.people.scoped.principalId,
        agentReply: true,
      })
      const ownTeam = await seedConv({
        marker,
        label: 'billing team',
        teamId: people.teams.billing,
      })
      const queue = await seedConv({ marker, label: 'unassigned' })
      const otherTeam = await seedConv({
        marker,
        label: 'support team',
        teamId: people.teams.support,
      })
      const someoneElse = await seedConv({
        marker,
        label: 'agent B no team',
        assigneeId: people.people.agentB.principalId,
        agentReply: true,
      })

      const api = await personApi(playwright, 'scoped')
      const list = await callServerFn(api, 'listInboxItemsFn', inboxListQuery(marker), {
        method: 'GET',
      })
      expect(listedIds(list.data).sort()).toEqual([mine.id, ownTeam.id, queue.id].sort())
      await api.dispose()

      const scoped = await asPerson('scoped')
      await searchInbox(scoped, marker)
      await expectListed(scoped, [mine, ownTeam, queue], [otherTeam, someoneElse])
    }
  )

  test(
    'ACC-04 a scoped teammate with no team lists only what is assigned to them plus the Unassigned queue',
    { tag: '@core' },
    async ({ browser, playwright, people, marker, newTeammate }) => {
      const t = await newTeammate({ roleKey: 'e2e_scoped_agent' })
      const mine = await seedConv({ marker, label: 'mine', assigneeId: t.principalId })
      const queue = await seedConv({ marker, label: 'unassigned' })
      const billing = await seedConv({
        marker,
        label: 'billing team',
        teamId: people.teams.billing,
      })
      const support = await seedConv({
        marker,
        label: 'support team',
        teamId: people.teams.support,
      })

      const api = await t.api(playwright)
      const list = await callServerFn(api, 'listInboxItemsFn', inboxListQuery(marker), {
        method: 'GET',
      })
      expect(listedIds(list.data).sort()).toEqual([mine.id, queue.id].sort())
      await api.dispose()

      const page = await t.newPage(browser)
      await searchInbox(page, marker)
      await expectListed(page, [mine, queue], [billing, support])
    }
  )
})

test.describe('opening by id', () => {
  test(
    'ACC-05 another team\'s conversation by deep link shows "Conversation not found" with no reply box; the server answers CONVERSATION_NOT_FOUND',
    { tag: '@smoke' },
    async ({ browser, playwright, people, marker, newTeammate }) => {
      const hidden = await seedConv({ marker, label: 'support team', teamId: people.teams.support })
      // A Contributor on team Billing, of this test's own (see ACC-02).
      const s = await newTeammate({ roleKey: 'contributor', teams: [people.teams.billing] })
      const contributor = await s.newPage(browser)
      await contributor.goto(`/admin/inbox?i=${hidden.id}`)
      await expect(contributor.getByText('Conversation not found')).toBeVisible({ timeout: 15_000 })
      await expect(contributor.getByRole('button', { name: 'Send reply' })).toHaveCount(0)
      await expect(contributor.getByText(hidden.messages[0])).toHaveCount(0)

      const api = await s.api(playwright)
      const res = await callServerFn(
        api,
        'getConversationFn',
        { conversationId: hidden.id },
        { method: 'GET' }
      )
      expect(res.code).toBe('CONVERSATION_NOT_FOUND')
      expect(res.error).not.toContain(hidden.messages[0])
      await api.dispose()
    }
  )

  test(
    'ACC-05 a teammate without conversation.view opening an Unassigned conversation by URL is refused, not shown an empty thread',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const queue = await seedConv({ marker, label: 'unassigned' })
      const noAccess = await asPerson('noAccess')
      await noAccess.goto(`/admin/inbox?i=${queue.id}`)
      await expect(
        noAccess.getByText(/Conversation not found|You don't have access/).first()
      ).toBeVisible({ timeout: 15_000 })
      await expect(noAccess.getByText('No messages yet')).toHaveCount(0)
      await expect(noAccess.getByRole('button', { name: 'Send reply' })).toHaveCount(0)

      // The server already refuses it.
      const api = await personApi(playwright, 'noAccess')
      const res = await callServerFn(
        api,
        'getConversationFn',
        { conversationId: queue.id },
        { method: 'GET' }
      )
      expect(res.ok).toBe(false)
      expect(res.error).not.toContain(queue.messages[0])
      await api.dispose()
    }
  )

  test(
    "ACC-06 once a conversation leaves the teammate's scope every write answers Not found first, and a reply claims only a true Unassigned conversation",
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const teamA = await createTeam(`${marker}-a`)
      const teamB = await createTeam(`${marker}-b`)
      const conv = await seedConv({ marker, label: 'team A', teamId: teamA.id })
      const queue = await seedConv({ marker, label: 'unassigned' })
      const w = await newTeammate({
        roleKey: await createRole(marker, SCOPED_WRITER),
        teams: [teamA.id],
      })
      const api = await w.api(playwright)
      const admin = await personApi(playwright, 'admin')

      // In scope: a note works.
      const note = await callServerFn(api, 'addConversationNoteFn', {
        conversationId: conv.id,
        content: `${marker} note`,
      })
      expect(note.ok, note.error).toBe(true)

      // A manager moves it to team B: it has left W's scope.
      const moved = await callServerFn(admin, 'assignConversationTeamFn', {
        conversationId: conv.id,
        teamId: teamB.id,
      })
      expect(moved.ok, moved.error).toBe(true)
      const before = await convRow(conv.id)
      const msg = await messageId(conv.id, conv.messages[0])

      // Each answers Not found before its own refusal could: translation, the
      // close guard, inline tag creation and macro rendering never run.
      for (const [fn, data, method] of [
        ['sendAgentMessageFn', { conversationId: conv.id, content: `${marker} reply` }, 'POST'],
        [
          'addConversationNoteFn',
          { conversationId: conv.id, content: `${marker} second note` },
          'POST',
        ],
        ['translateConversationMessagesFn', { conversationId: conv.id, messageIds: [msg] }, 'GET'],
        ['setConversationStatusFn', { conversationId: conv.id, status: 'closed' }, 'POST'],
        [
          'addConversationTagFn',
          { conversationId: conv.id, name: `${marker}-tag`.slice(0, 40) },
          'POST',
        ],
        ['assignConversationFn', { conversationId: conv.id, assignTo: 'me' }, 'POST'],
        ['assignConversationTeamFn', { conversationId: conv.id, teamId: teamA.id }, 'POST'],
        ['setConversationPriorityFn', { conversationId: conv.id, priority: 'high' }, 'POST'],
        ['snoozeConversationFn', { conversationId: conv.id, until: null }, 'POST'],
      ] as const) {
        const res = await callServerFn(api, fn, data, { method })
        expect(res.code, `${fn}: ${res.error.slice(0, 200)}`).toBe('CONVERSATION_NOT_FOUND')
      }
      const bulk = await callServerFn<{ failed: { id: string }[] }>(
        api,
        'bulkUpdateConversationsFn',
        {
          conversationIds: [conv.id],
          action: { type: 'close' },
        }
      )
      expect(bulk.data.failed.map((f) => f.id)).toEqual([conv.id])
      expect(await convRow(conv.id)).toEqual(before)

      // A reply on the true Unassigned queue claims it.
      const claim = await callServerFn(api, 'sendAgentMessageFn', {
        conversationId: queue.id,
        content: `${marker} claim`,
      })
      expect(claim.ok, claim.error).toBe(true)
      expect((await convRow(queue.id)).assigned_agent_principal_id).toBe(
        toUuid(w.principalId as `principal_${string}`)
      )
      await api.dispose()
      await admin.dispose()
    }
  )

  test(
    'ACC-07 the Unassigned queue is open to a scoped teammate: listed, opened, live, and their reply claims it; an unassigned ticket is not',
    { tag: '@smoke' },
    async ({ asPerson, playwright, people, marker }) => {
      test.setTimeout(60_000)
      const queue = await seedConv({ marker, label: 'unassigned' })
      const ticket = await seedTicket({ marker, label: 'unassigned ticket' })

      const scoped = await asPerson('scoped')
      await searchInbox(scoped, marker)
      await openFromList(scoped, queue)

      // Live: a teammate's note shows in the open thread without a reload.
      const admin = await personApi(playwright, 'admin')
      const note = await callServerFn(admin, 'addConversationNoteFn', {
        conversationId: queue.id,
        content: `${marker} live note`,
      })
      expect(note.ok, note.error).toBe(true)
      await expect(scoped.getByText(`${marker} live note`)).toBeVisible({ timeout: 10_000 })

      // The reply claims it.
      const composer = scoped.locator('.ProseMirror[contenteditable="true"]')
      await composer.click()
      await composer.fill(`${marker} scoped reply`)
      await scoped.getByRole('button', { name: 'Send reply' }).click()
      await expect(scoped.getByText(`${marker} scoped reply`).first()).toBeVisible({
        timeout: 10_000,
      })
      await expect
        .poll(async () => (await convRow(queue.id)).assigned_agent_principal_id)
        .toBe(toUuid(people.people.scoped.principalId as `principal_${string}`))
      await expect(scoped.getByRole('button', { name: /Sam Scoped/ }).first()).toBeVisible()

      // An unassigned ticket stays out of their list.
      const api = await personApi(playwright, 'scoped')
      const tickets = await callServerFn(
        api,
        'listInboxItemsFn',
        { ...inboxListQuery(marker), kinds: ['ticket'] },
        { method: 'GET' }
      )
      expect(tickets.ok, tickets.error).toBe(true)
      expect(listedIds(tickets.data)).not.toContain(ticket.id)
      const adminTickets = await callServerFn(
        admin,
        'listInboxItemsFn',
        { ...inboxListQuery(marker), kinds: ['ticket'] },
        { method: 'GET' }
      )
      expect(listedIds(adminTickets.data)).toContain(ticket.id)
      await api.dispose()
      await admin.dispose()
    }
  )

  test(
    'ACC-08 the conversation stream for a hidden conversation answers 404, for a teammate and for a visitor who does not own it',
    { tag: '@core' },
    async ({ people, marker }) => {
      const hidden = await seedConv({ marker, label: 'support team', teamId: people.teams.support })
      const own = await seedConv({ marker, label: 'billing team', teamId: people.teams.billing })

      const refused = await openStream({ person: 'scoped', query: { conversationId: hidden.id } })
      expect(refused.status).toBe(404)
      expect(refused.body).toBe('Not found')

      const allowed = await openStream({ person: 'scoped', query: { conversationId: own.id } })
      expect(allowed.status).toBe(200)
      allowed.close()

      // A signed-in customer asking for someone else's conversation.
      const visitor = await openStream({ person: 'customer', query: { conversationId: own.id } })
      expect(visitor.status).toBe(404)
    }
  )
})

test.describe('removal, bells and mentions', () => {
  test(
    'ACC-13 a removed teammate is refused at /admin, their keys stop working, they stay assignee, user.removed is audited and watcher bells stop',
    { tag: '@core' },
    async ({ browser, playwright, people, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const t = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [people.teams.billing] })
      const watcherControl = await newTeammate({
        roleKey: 'e2e_scoped_agent',
        teams: [people.teams.billing],
      })
      const conv = await seedConv({
        marker,
        label: 'assigned to T',
        assigneeId: t.principalId,
        teamId: people.teams.billing,
      })
      const ticket = await seedTicket({ marker, label: 'watched', teamId: people.teams.billing })
      const key = createSupportApiKey(t.email, 'personal')
      const auth = { authorization: `Bearer ${key}` }

      const tApi = await t.api(playwright)
      const ctrlApi = await watcherControl.api(playwright)
      for (const api of [tApi, ctrlApi]) {
        const w = await callServerFn(api, 'watchTicketFn', { ticketId: ticket.id })
        expect(w.ok, w.error).toBe(true)
      }
      expect((await tApi.get('/api/v1/conversations', { headers: auth })).status()).toBe(200)

      const admin = await personApi(playwright, 'admin')
      const removed = await callServerFn(admin, 'removeTeamMemberFn', {
        principalId: t.principalId,
      })
      expect(removed.ok, removed.error).toBe(true)

      // Refused at /admin.
      const page = await t.newPage(browser)
      await page.goto('/admin/inbox')
      await expect(page).not.toHaveURL(/\/admin/, { timeout: 15_000 })
      // Their personal key is revoked.
      expect((await tApi.get('/api/v1/conversations', { headers: auth })).status()).toBe(401)
      // They stay the assignee.
      expect((await convRow(conv.id)).assigned_agent_principal_id).toBe(
        toUuid(t.principalId as `principal_${string}`)
      )
      // Audited.
      const audits = await supportDb()`
      SELECT target_id, before_value, after_value FROM audit_log
      WHERE event_type = 'user.removed' AND occurred_at > NOW() - interval '5 minutes'`
      const audit = audits.find(
        (a) => JSON.stringify(a).includes(t.principalId) || JSON.stringify(a).includes(t.userId)
      )
      expect(audit, 'user.removed audit row').toBeTruthy()
      expect(audit?.after_value).toMatchObject({ role: 'user' })

      // A stage change bells the remaining watcher, never the removed one.
      const [closed] =
        await supportDb()`SELECT id FROM ticket_statuses WHERE category = 'pending' ORDER BY position LIMIT 1`
      const { fromUuid } = await import('@quackback/ids')
      const status = await callServerFn(admin, 'setTicketStatusFn', {
        ticketId: ticket.id,
        statusId: fromUuid('ticket_status', closed.id as string),
      })
      expect(status.ok, status.error).toBe(true)
      await pollFor("the remaining watcher's bell", async () =>
        (await bellsFor(watcherControl.principalId, ticket.id)).length > 0 ? true : null
      )
      expect(await bellsFor(t.principalId, ticket.id)).toEqual([])
      for (const api of [tApi, ctrlApi, admin]) await api.dispose()
    }
  )

  test(
    "ACC-14 assignment, team and mention notices on another team's conversation never reach a scoped teammate",
    { tag: '@smoke' },
    async ({ playwright, marker, newTeammate }) => {
      const teamA = await createTeam(`${marker}-a`)
      const teamB = await createTeam(`${marker}-b`)
      const s = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [teamA.id] })
      const b1 = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [teamB.id] })
      const b2 = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [teamB.id] })
      const conv = await seedConv({ marker, label: 'team B' })
      const admin = await personApi(playwright, 'admin')

      // Team assignment: bells team B's members.
      expect(
        (
          await callServerFn(admin, 'assignConversationTeamFn', {
            conversationId: conv.id,
            teamId: teamB.id,
          })
        ).ok
      ).toBe(true)
      // Assignment to a team B member.
      expect(
        (
          await callServerFn(admin, 'assignConversationFn', {
            conversationId: conv.id,
            assignTo: b1.principalId,
          })
        ).ok
      ).toBe(true)
      // A note mentioning S and a team B member.
      const note = await callServerFn(admin, 'addConversationNoteFn', {
        conversationId: conv.id,
        content: `${marker} mention`,
        contentJson: mentionDoc(`${marker} mention`, [s, b2]),
      })
      expect(note.ok, note.error).toBe(true)

      // Bounded by what team B heard: the last of these arrives after S's would.
      await pollFor('team B member mention bell', async () => {
        const bells = await bellsFor(b2.principalId, conv.id)
        return bells.some((b) => b.type === 'chat_mention') ? true : null
      })
      await pollFor('team B assignee bell', async () =>
        (await bellsFor(b1.principalId, conv.id)).length > 0 ? true : null
      )
      expect(await bellsFor(s.principalId, conv.id)).toEqual([])
      await admin.dispose()
    }
  )

  test(
    'ACC-15 the @ picker marks a teammate without access as "No access" and cannot pick them; a forced mention rings no bell',
    { tag: '@core' },
    async ({ asPerson, playwright, marker, newTeammate }) => {
      const teamB = await createTeam(`${marker}-b`)
      const outsider = await newTeammate({
        roleKey: 'e2e_scoped_agent',
        name: `Outsider ${marker.slice(-6)}`,
      })
      const insider = await newTeammate({
        roleKey: 'e2e_scoped_agent',
        teams: [teamB.id],
        name: `Insider ${marker.slice(-6)}`,
      })
      const conv = await seedConv({ marker, label: 'team B', teamId: teamB.id })

      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conv.id}`)
      await expect(admin.getByText(conv.messages[0]).first()).toBeVisible({ timeout: 15_000 })
      await admin.getByRole('button', { name: 'Reply', exact: true }).click()
      await admin.getByRole('menuitemradio', { name: 'Note' }).click()
      const composer = admin.locator('.ProseMirror[contenteditable="true"]')
      await composer.click()
      await composer.pressSequentially(`@Outsider ${marker.slice(-6)}`, { delay: 20 })
      const option = admin.getByRole('option', { name: new RegExp(`Outsider ${marker.slice(-6)}`) })
      await expect(option).toBeVisible({ timeout: 10_000 })
      await expect(option).toContainText('No access')
      await option.click({ force: true })
      await admin.keyboard.press('Enter')
      await expect(composer.locator('.mention')).toHaveCount(0)
      // Control: a teammate with access is picked as a mention.
      await composer.pressSequentially(` @Insider ${marker.slice(-6)}`, { delay: 20 })
      await admin.getByRole('option', { name: new RegExp(`Insider ${marker.slice(-6)}`) }).click()
      await expect(composer.locator('.mention')).toHaveCount(1)

      // A forced mention through the server: the insider hears, the outsider never.
      const api = await personApi(playwright, 'admin')
      const note = await callServerFn(api, 'addConversationNoteFn', {
        conversationId: conv.id,
        content: `${marker} forced`,
        contentJson: mentionDoc(`${marker} forced`, [outsider, insider]),
      })
      expect(note.ok, note.error).toBe(true)
      await pollFor('insider mention bell', async () =>
        (await bellsFor(insider.principalId, conv.id)).some((b) => b.type === 'chat_mention')
          ? true
          : null
      )
      expect(await bellsFor(outsider.principalId, conv.id)).toEqual([])
      await api.dispose()
    }
  )
})

test.describe('tickets', () => {
  test(
    'ACC-16 another team\'s ticket is not found by deep link; its linked conversation shows "Linked ticket you can\'t open" with no Create ticket',
    { tag: '@core' },
    async ({ asPerson, playwright, people, marker }) => {
      await turnOnFlag('supportTickets')
      const ticket = await seedTicket({
        marker,
        label: 'support ticket',
        teamId: people.teams.support,
        type: 'customer',
      })
      const conv = await seedConv({
        marker,
        label: 'billing conversation',
        teamId: people.teams.billing,
      })
      await supportDb()`INSERT INTO ticket_conversations (ticket_id, conversation_id, ticket_type)
                      VALUES (${toUuid(ticket.id as `ticket_${string}`)}, ${toUuid(conv.id as `conversation_${string}`)}, 'customer')`

      const scoped = await asPerson('scoped')
      await scoped.goto(`/admin/inbox?i=${ticket.id}`)
      await expect(scoped.getByText(/Ticket not found/)).toBeVisible({ timeout: 15_000 })
      await expect(scoped.getByText(ticket.title)).toHaveCount(0)

      await scoped.goto(`/admin/inbox?i=${conv.id}`)
      await expect(scoped.getByText(conv.messages[0]).first()).toBeVisible({ timeout: 15_000 })
      await scoped.getByRole('button', { name: 'Details' }).click()
      await expect(
        scoped.getByText("Linked ticket you can't open").filter({ visible: true })
      ).toBeVisible({ timeout: 10_000 })
      await expect(scoped.getByRole('button', { name: /Create ticket/ })).toHaveCount(0)
      await expect(scoped.getByText(ticket.title)).toHaveCount(0)

      // Writes by id answer not found too.
      const api = await personApi(playwright, 'scoped')
      const reply = await callServerFn(api, 'sendTicketMessageFn', {
        ticketId: ticket.id,
        content: `${marker} reply`,
      })
      expect(reply.code).toBe('TICKET_NOT_FOUND')
      await api.dispose()
    }
  )

  test(
    'ACC-17 a Contributor keeps Support in the rail with an empty ticket list; ticket functions refuse and the ticket stream answers 404',
    { tag: '@core' },
    async ({ asPerson, playwright, people, marker }) => {
      await turnOnFlag('supportTickets')
      const ticket = await seedTicket({
        marker,
        label: 'billing ticket',
        teamId: people.teams.billing,
      })
      const contributor = await asPerson('contributor')
      await contributor.goto('/admin')
      await expect(
        contributor
          .getByRole('navigation')
          .getByRole('link', { name: 'Support', exact: true })
          .first()
      ).toBeVisible({ timeout: 15_000 })

      const api = await personApi(playwright, 'contributor')
      const list = await callServerFn(
        api,
        'listInboxItemsFn',
        { ...inboxListQuery(marker), kinds: ['ticket'] },
        { method: 'GET' }
      )
      expect(list.ok ? listedIds(list.data) : []).toEqual([])
      const get = await callServerFn(api, 'getTicketFn', { ticketId: ticket.id }, { method: 'GET' })
      expect(get.ok).toBe(false)
      const reply = await callServerFn(api, 'sendTicketMessageFn', {
        ticketId: ticket.id,
        content: `${marker} reply`,
      })
      expect(reply.ok).toBe(false)
      await api.dispose()

      const stream = await openStream({ person: 'contributor', query: { ticketId: ticket.id } })
      expect(stream.status).toBe(404)
    }
  )

  test(
    'ACC-27 edit, delete, react and flag on a message whose conversation left scope answer MESSAGE_NOT_FOUND, even for its author',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const teamA = await createTeam(`${marker}-a`)
      const teamB = await createTeam(`${marker}-b`)
      const conv = await seedConv({ marker, label: 'team A', teamId: teamA.id })
      const ticket = await seedTicket({ marker, label: 'team A ticket', teamId: teamA.id })
      const w = await newTeammate({
        roleKey: await createRole(marker, SCOPED_WRITER),
        teams: [teamA.id],
      })
      const api = await w.api(playwright)
      const admin = await personApi(playwright, 'admin')

      expect(
        (
          await callServerFn(api, 'sendAgentMessageFn', {
            conversationId: conv.id,
            content: `${marker} own reply`,
          })
        ).ok
      ).toBe(true)
      expect(
        (
          await callServerFn(api, 'sendTicketMessageFn', {
            ticketId: ticket.id,
            content: `${marker} own ticket reply`,
          })
        ).ok
      ).toBe(true)
      const ownConvMsg = await messageId(conv.id, `${marker} own reply`)
      const visitorMsg = await messageId(conv.id, conv.messages[0])
      const [ticketMsgRow] =
        await supportDb()`SELECT id FROM conversation_messages WHERE ticket_id = ${toUuid(ticket.id as `ticket_${string}`)} AND content = ${`${marker} own ticket reply`}`
      const { fromUuid } = await import('@quackback/ids')
      const ownTicketMsg = fromUuid('conversation_msg', ticketMsgRow.id as string)

      // Both leave W's scope.
      // (W's reply claimed the conversation; take that away too.)
      expect(
        (
          await callServerFn(admin, 'assignConversationTeamFn', {
            conversationId: conv.id,
            teamId: teamB.id,
          })
        ).ok
      ).toBe(true)
      expect(
        (
          await callServerFn(admin, 'assignConversationFn', {
            conversationId: conv.id,
            assignTo: null,
          })
        ).ok
      ).toBe(true)
      await supportDb()`UPDATE tickets SET assignee_principal_id = NULL WHERE id = ${toUuid(ticket.id as `ticket_${string}`)}`
      await supportDb()`UPDATE tickets SET assignee_team_id = ${toUuid(teamB.id as `team_${string}`)} WHERE id = ${toUuid(ticket.id as `ticket_${string}`)}`

      for (const msg of [ownConvMsg, visitorMsg, ownTicketMsg]) {
        for (const [fn, data] of [
          ['editConversationMessageFn', { messageId: msg, content: 'edited' }],
          ['deleteConversationMessageFn', { messageId: msg }],
          ['addMessageReactionFn', { messageId: msg, emoji: '👍' }],
          ['setMessageFlagFn', { messageId: msg, flagged: true }],
        ] as const) {
          const res = await callServerFn(api, fn, data)
          expect(res.code, `${fn} on ${msg}: ${res.error.slice(0, 200)}`).toBe('MESSAGE_NOT_FOUND')
        }
      }
      const rows =
        await supportDb()`SELECT content, deleted_at FROM conversation_messages WHERE id IN ${supportDb()([ownConvMsg, ownTicketMsg].map((m) => toUuid(m as `conversation_msg_${string}`)))}`
      expect(rows.every((r) => r.deleted_at === null && r.content !== 'edited')).toBe(true)
      await api.dispose()
      await admin.dispose()
    }
  )
})

test.describe('non-team principals', () => {
  test(
    "ACC-29 a portal user never acts as an agent, and a teammate posting as the visitor on someone else's conversation gets Not found",
    { tag: '@nightly' },
    async ({ playwright, people, marker }) => {
      const conv = await seedConv({ marker, label: 'billing', teamId: people.teams.billing })
      const customer = await personApi(playwright, 'customer')
      for (const [fn, data] of [
        ['sendAgentMessageFn', { conversationId: conv.id, content: `${marker} as agent` }],
        ['addConversationNoteFn', { conversationId: conv.id, content: `${marker} as agent note` }],
        ['assignConversationFn', { conversationId: conv.id, assignTo: 'me' }],
      ] as const) {
        const res = await callServerFn(customer, fn, data)
        expect(res.ok, fn).toBe(false)
        expect(res.error, fn).toMatch(/Only team members can act as a support agent|Access denied/)
      }
      const scoped = await personApi(playwright, 'scoped')
      const asVisitor = await callServerFn(scoped, 'sendConversationMessageFn', {
        conversationId: conv.id,
        content: `${marker} as visitor`,
      })
      expect(asVisitor.ok).toBe(false)
      expect(asVisitor.code).toBe('CONVERSATION_NOT_FOUND')
      expect((await convRow(conv.id)).message_count).toBe(2)
      await customer.dispose()
      await scoped.dispose()
    }
  )
})
