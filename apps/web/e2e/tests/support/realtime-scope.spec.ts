/**
 * The live inbox follows each teammate's scope: a teammate's inbox stream
 * carries only frames for items they can see, an item that leaves their scope
 * is removed live, a role or team change reloads their scope, and removal
 * closes the stream.
 *
 * Absence is always checked after a later frame the same stream must carry
 * (noteAndWait), never by waiting out a timer.
 *
 * Journeys: ACC-09, ACC-10, ACC-11, ACC-12, RT-37, RT-38, RT-39, RT-40,
 * RT-41, RT-42, RT-44.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { inboxRow, seedConv, seedTicket } from '../../support/access'
import { about, noteAndWait, openInbox, removalOf } from '../../support/access-streams'
import { callServerFn, personApi } from '../../support/server-fns'
import { openStream, waitForStreamClosed, type OpenStream } from '../../support/streams'
import { runSweep } from '../../support/sweeps'
import { createTeam } from '../../support/teammates'

const SCOPED = 'e2e_scoped_agent'
const VIEW_ALL = 'manager'

/** Close every stream a test opened, even when it fails. */
let open: OpenStream[] = []
test.afterEach(() => {
  for (const s of open) s.close()
  open = []
})
const track = (s: OpenStream) => {
  open.push(s)
  return s
}

test(
  "RT-37 a scoped teammate's inbox stream carries own-team and Unassigned-queue frames, never another team's messages or notes",
  { tag: '@smoke' },
  async ({ playwright, marker, newTeammate }) => {
    const teamA = await createTeam(`${marker}-a`)
    const teamB = await createTeam(`${marker}-b`)
    const s = await newTeammate({ roleKey: SCOPED, teams: [teamA.id] })
    const v = await newTeammate({ roleKey: VIEW_ALL, principalRole: 'member' })
    const own = await seedConv({ marker, label: 'team A', teamId: teamA.id })
    const other = await seedConv({ marker, label: 'team B', teamId: teamB.id })
    const queue = await seedConv({ marker, label: 'unassigned' })
    const admin = await personApi(playwright, 'admin')
    const sStream = track(await openInbox(s))
    const vStream = track(await openInbox(v))
    await noteAndWait(admin, queue.id, [sStream, vStream], `${marker} warm-up`)

    const secret = `${marker} team B note body`
    await callServerFn(admin, 'addConversationNoteFn', {
      conversationId: other.id,
      content: secret,
    })
    await callServerFn(admin, 'setConversationPriorityFn', {
      conversationId: other.id,
      priority: 'high',
    })
    await noteAndWait(admin, queue.id, [sStream], `${marker} queue note`)
    await noteAndWait(admin, own.id, [sStream, vStream], `${marker} own-team note`)

    // The view-all teammate saw team B's frames; the scoped one none at all.
    expect(vStream.matching((e) => e.raw.includes(secret)).length).toBeGreaterThan(0)
    expect(sStream.matching(about(other.id))).toEqual([])
    expect(sStream.matching((e) => e.raw.includes(secret))).toEqual([])
    // The routing envelope stays on the server.
    for (const e of [...sStream.events, ...vStream.events])
      expect(Object.keys(e.data)).not.toContain('s')
    await admin.dispose()
  }
)

test(
  'ACC-09 ticket and conversation updates for another team never reach a scoped teammate; a view-all teammate gets them all',
  { tag: '@core' },
  async ({ playwright, marker, newTeammate }) => {
    const teamA = await createTeam(`${marker}-a`)
    const teamB = await createTeam(`${marker}-b`)
    const s = await newTeammate({ roleKey: SCOPED, teams: [teamA.id] })
    const v = await newTeammate({ roleKey: VIEW_ALL })
    const queue = await seedConv({ marker, label: 'unassigned' })
    const otherConv = await seedConv({ marker, label: 'team B', teamId: teamB.id })
    const otherTicket = await seedTicket({ marker, label: 'team B ticket', teamId: teamB.id })
    const ownTicket = await seedTicket({ marker, label: 'team A ticket', teamId: teamA.id })
    const admin = await personApi(playwright, 'admin')
    const sStream = track(await openInbox(s))
    const vStream = track(await openInbox(v))
    await noteAndWait(admin, queue.id, [sStream, vStream], `${marker} warm-up`)

    expect(
      (
        await callServerFn(admin, 'setTicketPriorityFn', {
          ticketId: otherTicket.id,
          priority: 'high',
        })
      ).ok
    ).toBe(true)
    expect(
      (
        await callServerFn(admin, 'setConversationStatusFn', {
          conversationId: otherConv.id,
          status: 'snoozed',
        })
      ).ok
    ).toBe(true)
    expect(
      (
        await callServerFn(admin, 'setTicketPriorityFn', {
          ticketId: ownTicket.id,
          priority: 'high',
        })
      ).ok
    ).toBe(true)
    await sStream.waitFor(about(ownTicket.id))
    await vStream.waitFor(about(ownTicket.id))

    expect(vStream.matching(about(otherTicket.id)).length).toBeGreaterThan(0)
    expect(vStream.matching(about(otherConv.id)).length).toBeGreaterThan(0)
    expect(sStream.matching(about(otherTicket.id))).toEqual([])
    expect(sStream.matching(about(otherConv.id))).toEqual([])
    await admin.dispose()
  }
)

test(
  "RT-38 an unassigned ticket's updates never reach a scoped teammate",
  { tag: '@core' },
  async ({ playwright, marker, newTeammate }) => {
    const teamA = await createTeam(`${marker}-a`)
    const s = await newTeammate({ roleKey: SCOPED, teams: [teamA.id] })
    const v = await newTeammate({ roleKey: VIEW_ALL })
    const queue = await seedConv({ marker, label: 'unassigned' })
    const unassignedTicket = await seedTicket({ marker, label: 'unassigned ticket' })
    const ownTicket = await seedTicket({ marker, label: 'team A ticket', teamId: teamA.id })
    const admin = await personApi(playwright, 'admin')
    const sStream = track(await openInbox(s))
    const vStream = track(await openInbox(v))
    await noteAndWait(admin, queue.id, [sStream, vStream], `${marker} warm-up`)

    expect(
      (
        await callServerFn(admin, 'setTicketPriorityFn', {
          ticketId: unassignedTicket.id,
          priority: 'urgent',
        })
      ).ok
    ).toBe(true)
    // The later in-scope marker.
    expect(
      (
        await callServerFn(admin, 'setTicketPriorityFn', {
          ticketId: ownTicket.id,
          priority: 'urgent',
        })
      ).ok
    ).toBe(true)
    await sStream.waitFor((e) => e.event === 'ticket_updated' && about(ownTicket.id)(e))
    await vStream.waitFor(about(ownTicket.id))

    expect(
      vStream.matching((e) => e.event === 'ticket_updated' && about(unassignedTicket.id)(e)).length
    ).toBeGreaterThan(0)
    expect(sStream.matching(about(unassignedTicket.id))).toEqual([])
    await admin.dispose()
  }
)

test(
  'RT-39 reassigning a conversation away removes it live: the scoped teammate\'s list drops it and the open pane shows "Conversation not found"',
  { tag: '@smoke' },
  async ({ browser, playwright, marker, newTeammate }) => {
    const teamA = await createTeam(`${marker}-a`)
    const teamB = await createTeam(`${marker}-b`)
    const s = await newTeammate({ roleKey: SCOPED, teams: [teamA.id] })
    const conv = await seedConv({ marker, label: 'team A', teamId: teamA.id })
    const sStream = track(await openInbox(s))
    const admin = await personApi(playwright, 'admin')
    await noteAndWait(admin, conv.id, [sStream], `${marker} warm-up`)

    const page = await s.newPage(browser)
    await page.goto(`/admin/inbox?view=all&q=${encodeURIComponent(marker)}&i=${conv.id}`)
    await expect(page.getByText(conv.messages[0]).first()).toBeVisible({ timeout: 15_000 })
    await expect(inboxRow(page, conv)).toBeVisible()

    expect(
      (
        await callServerFn(admin, 'assignConversationTeamFn', {
          conversationId: conv.id,
          teamId: teamB.id,
        })
      ).ok
    ).toBe(true)

    const removed = await sStream.waitFor(removalOf(conv.id))
    expect(removed.data).toMatchObject({ itemKind: 'conversation', id: conv.id })
    await expect(page.getByText('Conversation not found')).toBeVisible({ timeout: 10_000 })
    await expect(inboxRow(page, conv)).toHaveCount(0)
    await expect(page.getByText(conv.messages[0])).toHaveCount(0)
    await admin.dispose()
  }
)

test(
  "ACC-10 reassigning a ticket away removes it live from the scoped teammate's list and pane",
  { tag: '@core' },
  async ({ browser, playwright, marker, newTeammate }) => {
    const teamA = await createTeam(`${marker}-a`)
    const teamB = await createTeam(`${marker}-b`)
    const s = await newTeammate({ roleKey: SCOPED, teams: [teamA.id] })
    const ticket = await seedTicket({ marker, label: 'team A ticket', teamId: teamA.id })
    const sStream = track(await openInbox(s))
    const queue = await seedConv({ marker, label: 'unassigned' })
    const admin = await personApi(playwright, 'admin')
    await noteAndWait(admin, queue.id, [sStream], `${marker} warm-up`)

    const page = await s.newPage(browser)
    await page.goto(
      `/admin/inbox?view=tickets_all&status=all&q=${encodeURIComponent(marker)}&i=${ticket.id}`
    )
    const row = page.getByRole('button', { name: new RegExp(ticket.title) })
    await expect(row.first()).toBeVisible({ timeout: 15_000 })

    // Bulk assign moves it to team B.
    const bulk = await callServerFn<{ succeeded: string[] }>(admin, 'bulkUpdateTicketsFn', {
      ticketIds: [ticket.id],
      action: { type: 'assign_team', teamId: teamB.id },
    })
    expect(bulk.ok, bulk.error).toBe(true)
    expect(bulk.data.succeeded).toEqual([ticket.id])

    const removed = await sStream.waitFor(removalOf(ticket.id))
    expect(removed.data).toMatchObject({ itemKind: 'ticket', id: ticket.id })
    await expect(row).toHaveCount(0, { timeout: 10_000 })
    await expect(page.getByText(/Ticket not found/)).toBeVisible({ timeout: 10_000 })
    await admin.dispose()
  }
)

test(
  "RT-40 a reply that claims an Unassigned conversation removes it live from another scoped teammate's queue",
  { tag: '@core' },
  async ({ browser, playwright, marker, newTeammate }) => {
    const teamX = await createTeam(`${marker}-x`)
    const teamY = await createTeam(`${marker}-y`)
    const x = await newTeammate({ roleKey: SCOPED, teams: [teamX.id] })
    const y = await newTeammate({ roleKey: SCOPED, teams: [teamY.id] })
    const conv = await seedConv({ marker, label: 'unassigned' })
    const yStream = track(await openInbox(y))
    const admin = await personApi(playwright, 'admin')
    await noteAndWait(admin, conv.id, [yStream], `${marker} warm-up`)

    const page = await y.newPage(browser)
    await page.goto(`/admin/inbox?view=all&q=${encodeURIComponent(marker)}&i=${conv.id}`)
    await expect(page.getByText(conv.messages[0]).first()).toBeVisible({ timeout: 15_000 })

    const xApi = await x.api(playwright)
    const reply = await callServerFn(xApi, 'sendAgentMessageFn', {
      conversationId: conv.id,
      content: `${marker} X claims`,
    })
    expect(reply.ok, reply.error).toBe(true)

    await yStream.waitFor(removalOf(conv.id))
    await expect(page.getByText('Conversation not found')).toBeVisible({ timeout: 10_000 })
    await expect(inboxRow(page, conv)).toHaveCount(0)
    await xApi.dispose()
    await admin.dispose()
  }
)

test(
  'RT-41 deleting conversations sends one removal per row, only to teammates who held it',
  { tag: '@nightly' },
  async ({ playwright, request, marker, newTeammate }) => {
    const teamA = await createTeam(`${marker}-a`)
    const teamB = await createTeam(`${marker}-b`)
    const holder = await newTeammate({ roleKey: SCOPED, teams: [teamA.id] })
    const outsider = await newTeammate({ roleKey: SCOPED, teams: [teamB.id] })
    const queue = await seedConv({ marker, label: 'unassigned' })
    const bulkGone = await seedConv({
      marker,
      label: 'spam A bulk',
      teamId: teamA.id,
      status: 'closed',
    })
    const sweptGone = await seedConv({
      marker,
      label: 'spam A swept',
      teamId: teamA.id,
      status: 'closed',
    })
    await supportDb()`UPDATE conversations SET end_reason = 'spam', spam_reason = 'e2e-filter', resolved_at = NOW() - interval '40 days'
                    WHERE id IN ${supportDb()([bulkGone.id, sweptGone.id].map((id) => toUuid(id as `conversation_${string}`)))}`
    const hStream = track(await openInbox(holder))
    const oStream = track(await openInbox(outsider))
    const admin = await personApi(playwright, 'admin')
    await noteAndWait(admin, queue.id, [hStream, oStream], `${marker} warm-up`)

    const del = await callServerFn<{ succeeded: string[] }>(admin, 'bulkUpdateConversationsFn', {
      conversationIds: [bulkGone.id],
      action: { type: 'delete_forever' },
    })
    expect(del.ok, del.error).toBe(true)
    expect(del.data.succeeded).toEqual([bulkGone.id])
    await hStream.waitFor(removalOf(bulkGone.id))

    await runSweep(request, 'spam-retention')
    await hStream.waitFor(removalOf(sweptGone.id))

    await noteAndWait(admin, queue.id, [hStream, oStream], `${marker} closing marker`)
    expect(hStream.matching(removalOf(bulkGone.id))).toHaveLength(1)
    expect(hStream.matching(removalOf(sweptGone.id))).toHaveLength(1)
    expect(oStream.matching(about(bulkGone.id))).toEqual([])
    expect(oStream.matching(about(sweptGone.id))).toEqual([])
    await admin.dispose()
  }
)

test(
  'RT-42 a team or role change sends inbox_scope_changed and later frames follow the new scope',
  { tag: '@core' },
  async ({ playwright, marker, newTeammate }) => {
    const teamA = await createTeam(`${marker}-a`)
    const teamB = await createTeam(`${marker}-b`)
    const s = await newTeammate({ roleKey: SCOPED, teams: [teamA.id] })
    const queue = await seedConv({ marker, label: 'unassigned' })
    const other = await seedConv({ marker, label: 'team B', teamId: teamB.id })
    const elsewhere = await seedConv({
      marker,
      label: 'team C',
      teamId: (await createTeam(`${marker}-c`)).id,
    })
    const sStream = track(await openInbox(s))
    const admin = await personApi(playwright, 'admin')
    await noteAndWait(admin, queue.id, [sStream], `${marker} warm-up`)

    // Team change: S joins team B.
    expect(
      (
        await callServerFn(admin, 'setTeamMembersFn', {
          teamId: teamB.id,
          principalIds: [s.principalId],
        })
      ).ok
    ).toBe(true)
    await sStream.waitFor((e) => e.event === 'inbox_scope_changed')
    await noteAndWait(admin, other.id, [sStream], `${marker} team B now in scope`)
    expect(sStream.matching(about(elsewhere.id))).toEqual([])

    // Role change: to a role that sees every conversation.
    const [manager] = await supportDb()`SELECT id FROM roles WHERE key = 'manager'`
    const { fromUuid } = await import('@quackback/ids')
    const role = await callServerFn(admin, 'updateMemberRoleFn', {
      principalId: s.principalId,
      role: 'member',
      roleId: fromUuid('role', manager.id as string),
    })
    expect(role.ok, role.error).toBe(true)
    await sStream.waitFor((e) => e.event === 'inbox_scope_changed')
    await noteAndWait(admin, elsewhere.id, [sStream], `${marker} everything now in scope`)
    await admin.dispose()
  }
)

test(
  'ACC-11 removing a teammate from their team refreshes their open inbox live: the item shows Not found and leaves the list',
  { tag: '@core' },
  async ({ browser, playwright, marker, newTeammate }) => {
    const teamA = await createTeam(`${marker}-a`)
    const s = await newTeammate({ roleKey: SCOPED, teams: [teamA.id] })
    const conv = await seedConv({ marker, label: 'team A', teamId: teamA.id })
    const page = await s.newPage(browser)
    await page.goto(`/admin/inbox?view=all&q=${encodeURIComponent(marker)}&i=${conv.id}`)
    await expect(page.getByText(conv.messages[0]).first()).toBeVisible({ timeout: 15_000 })
    await expect(inboxRow(page, conv)).toBeVisible()
    // The page's own stream is subscribed once a note shows in the open thread.
    const admin = await personApi(playwright, 'admin')
    await expect(async () => {
      const text = `${marker} live ${Date.now()}`
      await callServerFn(admin, 'addConversationNoteFn', { conversationId: conv.id, content: text })
      await expect(page.getByText(text)).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 20_000 })

    expect(
      (await callServerFn(admin, 'setTeamMembersFn', { teamId: teamA.id, principalIds: [] })).ok
    ).toBe(true)

    // No reload: the scope signal makes the page refetch within a few seconds.
    await expect(page.getByText('Conversation not found')).toBeVisible({ timeout: 10_000 })
    await expect(inboxRow(page, conv)).toHaveCount(0)
    await admin.dispose()
  }
)

test(
  "ACC-12 removing a teammate closes their open inbox and the browser's reconnect is refused 403",
  { tag: '@core' },
  async ({ browser, playwright, marker, newTeammate }) => {
    const s = await newTeammate({ roleKey: SCOPED })
    const queue = await seedConv({ marker, label: 'unassigned' })
    const page = await s.newPage(browser)
    const refusals: number[] = []
    page.on('response', (r) => {
      if (r.url().includes('/api/chat/stream') && r.status() >= 400) refusals.push(r.status())
    })
    await page.goto(`/admin/inbox?view=all&q=${encodeURIComponent(marker)}&i=${queue.id}`)
    await expect(page.getByText(queue.messages[0]).first()).toBeVisible({ timeout: 15_000 })
    const admin = await personApi(playwright, 'admin')
    await expect(async () => {
      const text = `${marker} live ${Date.now()}`
      await callServerFn(admin, 'addConversationNoteFn', {
        conversationId: queue.id,
        content: text,
      })
      await expect(page.getByText(text)).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 20_000 })

    expect(
      (await callServerFn(admin, 'removeTeamMemberFn', { principalId: s.principalId })).ok
    ).toBe(true)

    // The browser's stream ends and its reconnect is refused.
    await expect.poll(() => refusals, { timeout: 20_000 }).toContain(403)
    // No further frame reaches the page.
    const after = `${marker} after removal`
    await callServerFn(admin, 'addConversationNoteFn', { conversationId: queue.id, content: after })
    await page.waitForTimeout(2_000)
    await expect(page.getByText(after)).toHaveCount(0)
    await admin.dispose()
  }
)

test(
  'RT-44 removal closes a raw inbox stream and the reconnect answers 403',
  { tag: '@core' },
  async ({ playwright, marker, newTeammate }) => {
    const s = await newTeammate({ roleKey: SCOPED })
    const queue = await seedConv({ marker, label: 'unassigned' })
    const sStream = track(await openInbox(s))
    const admin = await personApi(playwright, 'admin')
    await noteAndWait(admin, queue.id, [sStream], `${marker} warm-up`)

    expect(
      (await callServerFn(admin, 'removeTeamMemberFn', { principalId: s.principalId })).ok
    ).toBe(true)
    // The scope reload finds they are no longer a teammate and ends the stream.
    await callServerFn(admin, 'addConversationNoteFn', {
      conversationId: queue.id,
      content: `${marker} nudge`,
    })
    await waitForStreamClosed(sStream)

    const again = await openStream({ cookie: s.cookie, query: { scope: 'inbox' } })
    expect(again.status).toBe(403)
    await admin.dispose()
  }
)
