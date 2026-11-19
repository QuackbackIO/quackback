/**
 * Notifications (NTF-*): who gets a bell for what, what the bell says and
 * links to, the bell UI, and the per-type preference matrix.
 *
 * Every teammate who can see the Unassigned queue gets a bell for each new
 * visitor message in the shard, so a test that counts or clears someone's
 * bells first switches their "New message" bells off (a preference, the
 * product's own control) and only counts the type it is about.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { bellsFor, waitForBells, waitForEventHandled } from '../../support/bells'
import { supportDb } from '../../support/db'
import { emailLogFor, waitForEmailLog } from '../../support/mailpit'
import { callServerFn, personApi } from '../../support/server-fns'
import type { TestTeammate } from '../../support/teammates'
import { createTeam } from '../../support/teammates'
import { createVisitor } from '../../support/visitors'
import { setFeatureFlag } from '../../utils/db-helpers'
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'

/** Switch a teammate's "New message" bells and emails off (their own setting). */
async function quiet(playwright: PlaywrightWorkerArgs['playwright'], t: TestTeammate) {
  const api = await t.api(playwright)
  const r = await callServerFn(api, 'updateNotificationPreferencesFn', {
    matrix: { chat_message: { inApp: false, email: false } },
  })
  expect(r.ok, r.error).toBe(true)
  // Bells that landed before the switch (other tests' visitors) are noise for
  // this teammate's counts: let any in-flight write settle, then drop them.
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  await supportDb()`DELETE FROM in_app_notifications
    WHERE principal_id = ${toUuid(t.principalId as `principal_${string}`)}`
  return api
}

async function ticketStatusId(slug: string): Promise<string> {
  const { fromUuid } = await import('@quackback/ids')
  const [row] =
    await supportDb()`SELECT id FROM ticket_statuses WHERE slug = ${slug} AND deleted_at IS NULL`
  return fromUuid('ticket_status', row.id as string)
}

async function newConversation(playwright: PlaywrightWorkerArgs['playwright'], text: string) {
  const visitor = await createVisitor(playwright)
  const sent = await visitor.send(text)
  return { visitor, ...sent }
}

async function assign(api: APIRequestContext, conversationId: string, assignTo: string | null) {
  const r = await callServerFn(api, 'assignConversationFn', { conversationId, assignTo })
  expect(r.ok, r.error).toBe(true)
}

test.describe('notifications', () => {
  test.beforeAll(() => setFeatureFlag('supportTickets', true))

  test(
    'NTF-06 a first visitor message bells every teammate who can see it, with who and what',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const lead = await newTeammate({ roleKey: 'support_lead' })
      const blind = await newTeammate({ roleKey: 'e2e_no_support' })
      const long = `first ${marker} ${'x'.repeat(200)}`
      const { visitor, conversationId, messageId } = await newConversation(playwright, long)

      const [bell] = await waitForBells(lead.principalId, conversationId, (r) => r.length >= 1)
      expect(bell).toMatchObject({
        type: 'chat_message',
        title: `New message from ${visitor.name}`,
      })
      expect(long.startsWith(bell.body!.replace(/(\.\.\.|…)$/, ''))).toBe(true)
      expect(bell.body!.length).toBe(140)
      expect(bell.metadata).toMatchObject({ conversationId })

      await waitForEventHandled(messageId, { type: 'message.created' })
      expect(await bellsFor(blind.principalId, conversationId)).toEqual([])
    }
  )

  test(
    'NTF-11 an assignment bells the assignee and the team, never the actor, an outsider or a removed teammate',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const team = await createTeam(marker)
      const actor = await newTeammate({ roleKey: 'admin', teams: [team.id] })
      const actorApi = await quiet(playwright, actor)
      const assignee = await newTeammate({ roleKey: 'support_lead', teams: [team.id] })
      const member = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [team.id] })
      const outsider = await newTeammate({ roleKey: 'e2e_scoped_agent' })
      for (const t of [assignee, member, outsider]) await quiet(playwright, t)

      const { conversationId } = await newConversation(playwright, `assign ${marker}`)
      await assign(actorApi, conversationId, assignee.principalId)
      const [direct] = await waitForBells(
        assignee.principalId,
        conversationId,
        (r) => r.length >= 1
      )
      expect(direct).toMatchObject({
        type: 'conversation_assigned',
        title: 'You were assigned a conversation',
      })

      const teamed = await callServerFn(actorApi, 'assignConversationTeamFn', {
        conversationId,
        teamId: team.id,
      })
      expect(teamed.ok, teamed.error).toBe(true)
      const [teamBell] = await waitForBells(
        member.principalId,
        conversationId,
        (r) => r.length >= 1
      )
      expect(teamBell).toMatchObject({
        type: 'conversation_assigned',
        title: 'A conversation was assigned to your team',
      })
      expect(await bellsFor(actor.principalId, conversationId)).toEqual([])
      expect(await bellsFor(outsider.principalId, conversationId)).toEqual([])

      // Self-assignment and a no-change re-assignment ring nobody.
      const before = (await bellsFor(assignee.principalId, conversationId)).length
      await assign(actorApi, conversationId, 'me')
      await assign(actorApi, conversationId, assignee.principalId)
      await waitForBells(assignee.principalId, conversationId, (r) => r.length === before + 1)
      await assign(actorApi, conversationId, assignee.principalId)
      expect(await bellsFor(actor.principalId, conversationId)).toEqual([])

      // A removed teammate kept as assignee gets nothing new.
      const removed = await newTeammate({ roleKey: 'support_lead' })
      await quiet(playwright, removed)
      const second = await newConversation(playwright, `removed ${marker}`)
      await supportDb()`UPDATE principal SET role = 'user'
      WHERE id = ${toUuid(removed.principalId as `principal_${string}`)}`
      const refused = await callServerFn(actorApi, 'assignConversationFn', {
        conversationId: second.conversationId,
        assignTo: removed.principalId,
      })
      expect(refused.ok).toBe(false)
      expect(await bellsFor(removed.principalId, second.conversationId)).toEqual([])

      // Conversation assignment sends no email. (In-scope teammates also get
      // the team's new-message email for other tests' visitors, which the
      // per-type switch does not cover, a known gap: those are left out.)
      await waitForEventHandled(conversationId, { type: 'conversation.assigned' })
      const mails = await emailLogFor(assignee.email)
      expect(mails.filter((m) => m.email_type !== 'ConversationMessageEmail')).toEqual([])
    }
  )

  test(
    'NTF-01 the bell badge counts unread notifications and picks up new ones',
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const t = await newTeammate({ roleKey: 'support_lead' })
      await quiet(playwright, t)
      const admin = await personApi(playwright, 'admin')
      for (const n of [1, 2]) {
        const { conversationId } = await newConversation(playwright, `bell ${n} ${marker}`)
        await assign(admin, conversationId, t.principalId)
        await waitForBells(t.principalId, conversationId, (r) => r.length === 1)
      }
      const page = await t.newPage(browser)
      await page.goto('/admin/feedback')
      await expect(page.getByRole('button', { name: 'Notifications (2 unread)' })).toBeVisible({
        timeout: 15_000,
      })

      const { conversationId } = await newConversation(playwright, `bell 3 ${marker}`)
      await assign(admin, conversationId, t.principalId)
      await waitForBells(t.principalId, conversationId, (r) => r.length === 1)
      await page.reload()
      await expect(page.getByRole('button', { name: 'Notifications (3 unread)' })).toBeVisible({
        timeout: 15_000,
      })
      await admin.dispose()
    }
  )

  test(
    'NTF-03 clicking a notification marks it read and opens the conversation or ticket',
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const t = await newTeammate({ roleKey: 'support_lead' })
      await quiet(playwright, t)
      const admin = await personApi(playwright, 'admin')
      const { visitor, conversationId } = await newConversation(playwright, `open me ${marker}`)
      await assign(admin, conversationId, t.principalId)
      const [bell] = await waitForBells(t.principalId, conversationId, (r) => r.length === 1)

      const page = await t.newPage(browser)
      await page.goto('/admin/feedback')
      const bellButton = page.getByRole('button', { name: /^Notifications/ })
      await expect(async () => {
        await bellButton.click()
        await page.getByText('You were assigned a conversation').first().click({ timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
      await expect(page).toHaveURL(new RegExp(`/admin/inbox\\?i=${conversationId}`), {
        timeout: 15_000,
      })
      await expect(page.getByText(`open me ${marker}`).first()).toBeVisible({ timeout: 15_000 })
      await expect
        .poll(async () => (await bellsFor(t.principalId, conversationId))[0]?.read_at ?? null)
        .not.toBeNull()
      expect(bell.read_at).toBeNull()

      // A ticket assignment opens the ticket.
      const ticket = await callServerFn<{ id: string }>(admin, 'createTicketFn', {
        type: 'customer',
        title: `Ticket ${marker}`,
        requesterPrincipalId: await visitor.principalId(),
      })
      expect(ticket.ok, ticket.error).toBe(true)
      const assigned = await callServerFn(admin, 'assignTicketFn', {
        ticketId: ticket.data.id,
        assigneePrincipalId: t.principalId,
      })
      expect(assigned.ok, assigned.error).toBe(true)
      await waitForBells(t.principalId, ticket.data.id, (r) => r.length === 1)
      await page.goto('/admin/feedback')
      await expect(async () => {
        await bellButton.click()
        await page.getByText('You were assigned a ticket').first().click({ timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
      await expect(page).toHaveURL(new RegExp(`/admin/inbox\\?i=${ticket.data.id}`), {
        timeout: 15_000,
      })
      await admin.dispose()
    }
  )

  test(
    'NTF-09 a visitor message on a ticket-paired conversation does not bell the whole team',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const lead = await newTeammate({ roleKey: 'support_lead' })
      const admin = await personApi(playwright, 'admin')
      const { visitor, conversationId } = await newConversation(playwright, `pair me ${marker}`)
      // The unpaired first message does bell the team (the control).
      await waitForBells(lead.principalId, conversationId, (r) => r.length === 1)
      const ticket = await callServerFn<{ id: string }>(admin, 'createTicketFn', {
        type: 'customer',
        title: `Paired ${marker}`,
        conversationId,
        requesterPrincipalId: await visitor.principalId(),
      })
      expect(ticket.ok, ticket.error).toBe(true)
      expect(
        (
          await callServerFn(admin, 'linkTicketToConversationFn', {
            ticketId: ticket.data.id,
            conversationId,
          })
        ).ok
      ).toBe(true)

      const reply = await visitor.send(`on the ticket ${marker}`, conversationId)
      await waitForEventHandled(reply.messageId, { type: 'message.created' })
      const bells = await bellsFor(lead.principalId, conversationId)
      expect(bells.filter((b) => b.type === 'chat_message')).toHaveLength(1)
      expect(bells.some((b) => b.body?.includes(`on the ticket ${marker}`))).toBe(false)
      await admin.dispose()
    }
  )

  test(
    'NTF-15 a ticket stage change bells the requester and agent watchers, not the actor',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const actor = await newTeammate({ roleKey: 'admin' })
      const actorApi = await actor.api(playwright)
      const watcher = await newTeammate({ roleKey: 'support_lead' })
      const visitor = await createVisitor(playwright, { email: `${marker}@customers.example` })
      const { conversationId } = await visitor.send(`stage ${marker}`)
      const title = `Stage ${marker}`
      const ticket = await callServerFn<{ id: string }>(actorApi, 'createTicketFn', {
        type: 'customer',
        title,
        conversationId,
        requesterPrincipalId: await visitor.principalId(),
      })
      expect(ticket.ok, ticket.error).toBe(true)
      const ticketId = ticket.data.id
      expect(
        (await callServerFn(actorApi, 'linkTicketToConversationFn', { ticketId, conversationId }))
          .ok
      ).toBe(true)
      expect(
        (
          await callServerFn(actorApi, 'adminAddTicketWatcherFn', {
            ticketId,
            principalId: watcher.principalId,
          })
        ).ok
      ).toBe(true)

      const move = async (slug: string) => {
        const r = await callServerFn(actorApi, 'setTicketStatusFn', {
          ticketId,
          statusId: await ticketStatusId(slug),
        })
        expect(r.ok, r.error).toBe(true)
      }
      await move('investigating')
      const stage = (rows: Awaited<ReturnType<typeof bellsFor>>) =>
        rows.filter((b) => b.type === 'ticket_status_changed')
      const [agentBell] = stage(
        await waitForBells(watcher.principalId, ticketId, (r) => stage(r).length === 1)
      )
      expect(agentBell).toMatchObject({
        title: `${title} is now In progress`,
        body: 'Moved from Received to In progress',
      })
      expect(agentBell.metadata).toMatchObject({ audience: 'admin' })
      const [requesterBell] = stage(
        await waitForBells(await visitor.principalId(), ticketId, (r) => stage(r).length === 1)
      )
      expect(requesterBell.title).toBe(`${title} is now In progress`)
      expect(requesterBell.metadata).toMatchObject({ audience: 'portal' })
      expect(stage(await bellsFor(actor.principalId, ticketId))).toEqual([])

      // Within one stage (Investigating to Escalated): silent. Then a real move
      // proves the silence was not just slowness.
      await move('escalated')
      await move('resolved')
      const rows = stage(
        await waitForBells(watcher.principalId, ticketId, (r) => stage(r).length === 2)
      )
      expect(rows[1].title).toBe(`${title} is now Resolved`)
      expect(rows[1].body).toBe('Moved from In progress to Resolved')
    }
  )

  test(
    'NTF-22 switching a type off for email stops the email while the bell still arrives',
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(90_000)
      const t = await newTeammate({ roleKey: 'support_lead' })
      await quiet(playwright, t)
      const admin = await personApi(playwright, 'admin')
      const visitor = await createVisitor(playwright)
      await visitor.send(`requester ${marker}`)
      const newTicket = async (n: number) => {
        const r = await callServerFn<{ id: string }>(admin, 'createTicketFn', {
          type: 'customer',
          title: `Prefs ${n} ${marker}`,
          requesterPrincipalId: await visitor.principalId(),
        })
        expect(r.ok, r.error).toBe(true)
        const a = await callServerFn(admin, 'assignTicketFn', {
          ticketId: r.data.id,
          assigneePrincipalId: t.principalId,
        })
        expect(a.ok, a.error).toBe(true)
        return r.data.id
      }

      // Default on: a ticket assignment bells and emails.
      const first = await newTicket(1)
      await waitForBells(t.principalId, first, (r) => r.some((b) => b.type === 'ticket_assigned'))
      // (Only the assignment emails count: the team's new-message email ignores
      // the per-type switch, a known gap.)
      const assignedMails = async () =>
        (await emailLogFor(t.email)).filter((m) => m.email_type === 'TicketEventEmail')
      await waitForEmailLog(t.email, { email_type: 'TicketEventEmail' })
      const mailsBefore = (await assignedMails()).length
      expect(mailsBefore).toBe(1)

      // Email off for "Ticket assigned", in the matrix.
      const page = await t.newPage(browser)
      await page.goto('/admin/settings/notifications')
      const emailSwitch = page.getByRole('switch', { name: 'Ticket assigned - Email' })
      await expect(async () => {
        await page.getByRole('tab', { name: 'Support' }).click()
        await expect(emailSwitch).toBeChecked({ timeout: 1_500 })
      }).toPass({ timeout: 20_000 })
      await emailSwitch.click()
      await expect(emailSwitch).not.toBeChecked()
      await expect
        .poll(async () => {
          const [row] = await supportDb()`SELECT 1 FROM notification_preferences
          WHERE principal_id = ${toUuid(t.principalId as `principal_${string}`)}
            AND matrix::text LIKE '%ticket_assigned%'`
          return Boolean(row)
        })
        .toBe(true)
      await expect(page.getByRole('switch', { name: 'Ticket assigned - In-app' })).toBeChecked()

      const second = await newTicket(2)
      await waitForBells(t.principalId, second, (r) => r.some((b) => b.type === 'ticket_assigned'))
      await waitForEventHandled(second, { type: 'ticket.assigned' })
      expect((await assignedMails()).length).toBe(mailsBefore)
      await admin.dispose()
    }
  )

  test(
    "NTF-33 inbox nav counts follow each teammate's scope, and a role without view is refused",
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const team = await createTeam(marker)
      const t = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [team.id] })
      const admin = await personApi(playwright, 'admin')
      for (const n of [1, 2]) {
        const { conversationId } = await newConversation(playwright, `mine ${n} ${marker}`)
        await assign(admin, conversationId, t.principalId)
        // Answered, so a stream closing never returns it to the queue.
        expect(
          (await callServerFn(admin, 'sendAgentMessageFn', { conversationId, content: `hi ${n}` }))
            .ok
        ).toBe(true)
        await assign(admin, conversationId, t.principalId)
      }
      const tApi = await t.api(playwright)
      const counts = await callServerFn<Record<string, unknown>>(
        tApi,
        'fetchInboxCountsFn',
        undefined,
        { method: 'GET' }
      )
      expect(counts.ok, counts.error).toBe(true)
      expect(counts.data).toMatchObject({ mine: 2 })

      const page = await t.newPage(browser)
      await page.goto('/admin/inbox')
      const mine = page.locator('a, button', { hasText: 'Assigned to me' }).first()
      await expect(mine).toContainText('2', { timeout: 15_000 })

      const blind = await newTeammate({ roleKey: 'e2e_no_support' })
      const refused = await callServerFn(
        await blind.api(playwright),
        'fetchInboxCountsFn',
        undefined,
        { method: 'GET' }
      )
      expect(refused.ok).toBe(false)
      expect(refused.code).toBe('FORBIDDEN')
      expect(refused.error).toContain('You cannot view the inbox')
      await admin.dispose()
    }
  )

  test(
    'NTF-02 the dropdown lists the latest ten and Mark all read clears the badge',
    { tag: '@nightly' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(120_000)
      const t = await newTeammate({ roleKey: 'support_lead' })
      await quiet(playwright, t)
      const admin = await personApi(playwright, 'admin')
      for (let n = 1; n <= 12; n++) {
        const { conversationId } = await newConversation(playwright, `twelve ${n} ${marker}`)
        await assign(admin, conversationId, t.principalId)
      }
      await waitForBells(t.principalId, undefined, (r) => r.length === 12, 30_000)
      const page = await t.newPage(browser)
      await page.goto('/admin/feedback')
      const bell = page.getByRole('button', { name: 'Notifications (12 unread)' })
      await expect(bell).toBeVisible({ timeout: 15_000 })
      await expect(async () => {
        await bell.click()
        await expect(page.getByText('You were assigned a conversation')).toHaveCount(10, {
          timeout: 2_000,
        })
      }).toPass({ timeout: 20_000 })
      await page.getByRole('button', { name: 'Mark all read' }).click()
      await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible({
        timeout: 10_000,
      })
      await expect
        .poll(async () => (await bellsFor(t.principalId)).every((b) => b.read_at !== null))
        .toBe(true)
      await admin.dispose()
    }
  )

  test(
    'NTF-04 the notifications page: All and Unread tabs, archive, archive all read',
    { tag: '@nightly' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(90_000)
      const t = await newTeammate({ roleKey: 'support_lead' })
      const tApi = await quiet(playwright, t)
      const admin = await personApi(playwright, 'admin')
      const ids: string[] = []
      for (let n = 1; n <= 3; n++) {
        const { conversationId } = await newConversation(playwright, `page ${n} ${marker}`)
        await assign(admin, conversationId, t.principalId)
        ids.push(conversationId)
      }
      const rows = await waitForBells(t.principalId, undefined, (r) => r.length === 3)
      // One read, two unread.
      const [readOne] = await bellsFor(t.principalId, ids[0])
      expect(
        (await callServerFn(tApi, 'markNotificationAsReadFn', { notificationId: readOne.id })).ok
      ).toBe(true)

      const page = await t.newPage(browser)
      await page.goto('/admin/notifications')
      const items = page.getByText('You were assigned a conversation')
      await expect(items).toHaveCount(3, { timeout: 15_000 })
      await page.goto('/admin/notifications?filter=unread')
      await expect(items).toHaveCount(2, { timeout: 15_000 })

      // Archive all read: only the read one goes.
      await page.goto('/admin/notifications')
      await expect(items).toHaveCount(3, { timeout: 15_000 })
      await expect(async () => {
        await page.getByRole('button', { name: 'More notification actions' }).click()
        await page.getByRole('menuitem', { name: 'Archive all read' }).click({ timeout: 1_500 })
      }).toPass({ timeout: 15_000 })
      await page.getByRole('button', { name: 'Archive', exact: true }).click()
      await expect(items).toHaveCount(2, { timeout: 10_000 })
      await expect
        .poll(async () =>
          (await bellsFor(t.principalId)).filter((b) => b.archived_at !== null).map((b) => b.id)
        )
        .toEqual([readOne.id])
      expect(rows).toHaveLength(3)

      // Archive one unread row.
      const [target] = await bellsFor(t.principalId, ids[1])
      expect(
        (await callServerFn(tApi, 'archiveNotificationFn', { notificationId: target.id })).ok
      ).toBe(true)
      await page.reload()
      await expect(items).toHaveCount(1, { timeout: 15_000 })
      await expect(page.getByRole('button', { name: 'Notifications (1 unread)' })).toBeVisible()
      await admin.dispose()
    }
  )

  test(
    "NTF-05 a teammate cannot mark read or archive someone else's notification",
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const owner = await newTeammate({ roleKey: 'support_lead' })
      await quiet(playwright, owner)
      const other = await newTeammate({ roleKey: 'support_lead' })
      const admin = await personApi(playwright, 'admin')
      const { conversationId } = await newConversation(playwright, `not yours ${marker}`)
      await assign(admin, conversationId, owner.principalId)
      const [bell] = await waitForBells(owner.principalId, conversationId, (r) => r.length === 1)

      const otherApi = await other.api(playwright)
      for (const fn of ['markNotificationAsReadFn', 'archiveNotificationFn']) {
        const r = await callServerFn(otherApi, fn, { notificationId: bell.id })
        expect(r.ok, fn).toBe(false)
        expect(r.code, fn).toBe('NOTIFICATION_NOT_FOUND')
      }
      const [unchanged] = await bellsFor(owner.principalId, conversationId)
      expect(unchanged).toMatchObject({ read_at: null, archived_at: null })
      await admin.dispose()
    }
  )

  test(
    'NTF-18 an internal ticket note bells agent watchers only, never the requester',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const actor = await newTeammate({ roleKey: 'admin' })
      const actorApi = await actor.api(playwright)
      const watcher = await newTeammate({ roleKey: 'support_lead' })
      const visitor = await createVisitor(playwright, { email: `${marker}@customers.example` })
      const { conversationId } = await visitor.send(`note ${marker}`)
      const ticket = await callServerFn<{ id: string }>(actorApi, 'createTicketFn', {
        type: 'customer',
        title: `Noted ${marker}`,
        conversationId,
        requesterPrincipalId: await visitor.principalId(),
      })
      expect(ticket.ok, ticket.error).toBe(true)
      const ticketId = ticket.data.id
      expect(
        (await callServerFn(actorApi, 'linkTicketToConversationFn', { ticketId, conversationId }))
          .ok
      ).toBe(true)
      expect(
        (
          await callServerFn(actorApi, 'adminAddTicketWatcherFn', {
            ticketId,
            principalId: watcher.principalId,
          })
        ).ok
      ).toBe(true)
      const note = await callServerFn(actorApi, 'addTicketNoteFn', {
        ticketId,
        content: `internal ${marker}`,
      })
      expect(note.ok, note.error).toBe(true)

      const notes = (r: Awaited<ReturnType<typeof bellsFor>>) =>
        r.filter((b) => b.type === 'ticket_note_added')
      const [bell] = notes(
        await waitForBells(watcher.principalId, ticketId, (r) => notes(r).length === 1)
      )
      expect(bell.metadata).toMatchObject({ audience: 'admin' })
      await waitForEventHandled(`internal ${marker}`)
      expect(notes(await bellsFor(await visitor.principalId(), ticketId))).toEqual([])
      expect(notes(await bellsFor(actor.principalId, ticketId))).toEqual([])
    }
  )

  test(
    'TKT-57 a visitor message on a paired conversation rings no team-wide bell',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const lead = await newTeammate({ roleKey: 'support_lead' })
      const admin = await personApi(playwright, 'admin')
      const { visitor, conversationId } = await newConversation(playwright, `paired ${marker}`)
      const ticket = await callServerFn<{ id: string }>(admin, 'createTicketFn', {
        type: 'customer',
        title: `TKT-57 ${marker}`,
        conversationId,
        requesterPrincipalId: await visitor.principalId(),
      })
      expect(ticket.ok, ticket.error).toBe(true)
      expect(
        (
          await callServerFn(admin, 'linkTicketToConversationFn', {
            ticketId: ticket.data.id,
            conversationId,
          })
        ).ok
      ).toBe(true)
      const reply = await visitor.send(`requester follow-up ${marker}`, conversationId)
      await waitForEventHandled(reply.messageId, { type: 'message.created' })
      expect(
        (await bellsFor(lead.principalId, conversationId)).some((b) =>
          b.body?.includes('requester follow-up')
        )
      ).toBe(false)
      await admin.dispose()
    }
  )

  test(
    'TKT-57 a visitor message on a paired conversation sends ticket.replied to the ticket watchers',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const watcher = await newTeammate({ roleKey: 'support_lead' })
      const admin = await personApi(playwright, 'admin')
      const { visitor, conversationId } = await newConversation(playwright, `watched ${marker}`)
      const ticket = await callServerFn<{ id: string }>(admin, 'createTicketFn', {
        type: 'customer',
        title: `Watched ${marker}`,
        conversationId,
        requesterPrincipalId: await visitor.principalId(),
      })
      expect(ticket.ok, ticket.error).toBe(true)
      const ticketId = ticket.data.id
      expect(
        (await callServerFn(admin, 'linkTicketToConversationFn', { ticketId, conversationId })).ok
      ).toBe(true)
      expect(
        (
          await callServerFn(admin, 'adminAddTicketWatcherFn', {
            ticketId,
            principalId: watcher.principalId,
          })
        ).ok
      ).toBe(true)
      await visitor.send(`watched reply ${marker}`, conversationId)
      await waitForBells(watcher.principalId, ticketId, (r) =>
        r.some((b) => b.type === 'ticket_replied')
      )
      const [event] =
        await supportDb()`SELECT 1 FROM events WHERE type = 'ticket.replied' AND payload::text LIKE ${`%watched reply ${marker}%`}`
      expect(event).toBeTruthy()
      await admin.dispose()
    }
  )
})
