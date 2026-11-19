/**
 * Support inbox thread actions: assignment, snooze, close and reopen, tags,
 * macros, outbound conversations and availability (journeys INB-46..INB-91).
 *
 * Every test works on conversations it seeded or started itself and opens
 * them by URL; per-person outcomes (bells, Assigned to me, availability) use
 * minted teammates nobody else touches.
 */
import type { Browser, Page } from '@playwright/test'
import { waitForMail } from '../../support/mailpit'
import {
  test,
  expect,
  bellsFor,
  conversationState,
  conversationTypeId,
  conversationWithMessage,
  detailsPanel,
  inboxUrl,
  listRows,
  messagesOf,
  openConversation,
  seedMacro,
  seedTag,
  sendFromComposer,
  threadMessages,
  systemNotices,
  waitForBell,
  waitForConversation,
  widgetStartConversation,
} from '../../support/inbox'
import { supportDb } from '../../support/db'
import { runSweep } from '../../support/sweeps'

test.use({ viewport: { width: 1920, height: 1080 } })

/** Hold a minted teammate's presence stream open from the test process. */
async function holdPresenceFor(cookie: string): Promise<{ release: () => void }> {
  const { supportEnv } = await import('../../support/env')
  const controller = new AbortController()
  const res = await fetch(`${supportEnv().baseUrl}/api/chat/stream?scope=presence`, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  })
  if (!res.ok || !res.body) throw new Error(`presence stream answered ${res.status}`)
  const reader = res.body.getReader()
  void (async () => {
    try {
      while (!(await reader.read()).done) {
        // keep reading heartbeats
      }
    } catch {
      // aborted
    }
  })()
  return { release: () => controller.abort() }
}

/** A team of this test's own with a given assignment method. */
async function seedTeam(name: string, method = 'manual'): Promise<string> {
  const { generateId, toUuid } = await import('@quackback/ids')
  const id = generateId('team')
  await supportDb()`INSERT INTO teams (id, name, assignment_method)
                    VALUES (${toUuid(id)}, ${name}, ${method})`
  return id
}

/** Open the team menu for the open conversation (`t`) and pick a team. */
async function assignTeamByKeyboard(page: Page, teamName: string) {
  await expect(async () => {
    await page.locator('body').press('t')
    await expect(page.getByRole('menuitem', { name: teamName })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  await page.getByRole('menuitem', { name: teamName }).click()
}

/** An anonymous visitor who started a conversation in the widget. */
async function widgetVisitor(browser: Browser, text: string) {
  const page = await (await browser.newContext()).newPage()
  await widgetStartConversation(page, text)
  const uuid = await conversationWithMessage(text)
  return { page, uuid, id: conversationTypeId(uuid) }
}

/** The details panel's assignee control (its label is the assignee's name). */
function assigneeButton(page: Page, label: string | RegExp) {
  return detailsPanel(page).getByRole('button', { name: label })
}

/** Pick from a menu opened by `trigger`, retrying until the item appears. */
async function pick(page: Page, trigger: import('@playwright/test').Locator, item: string) {
  await expect(async () => {
    await trigger.click()
    await page.getByRole('menuitem', { name: item }).first().click({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

test.describe('inbox thread actions', () => {
  test(
    'INB-46 assigning a teammate adds an internal notice, a bell for them, and nothing for the visitor',
    {
      tag: '@smoke',
    },
    async ({ teammate, browser, marker }) => {
      test.setTimeout(45_000)
      const { page } = await teammate()
      const { mate: b } = await teammate({ name: `Bea ${marker.slice(-6)}` })
      const visitor = await widgetVisitor(browser, `Need a hand ${marker}`)
      await openConversation(page, visitor.id, `Need a hand ${marker}`)

      await pick(page, assigneeButton(page, 'Unassigned'), b.name)
      const notice = `Conversation assigned to ${b.name}`
      await expect(threadMessages(page, notice)).toBeVisible({ timeout: 15_000 })
      await expect(assigneeButton(page, b.name)).toBeVisible()
      await waitForConversation(
        visitor.uuid,
        'the assignee',
        (r) => r.assigned_agent_principal_id === b.principalUuid
      )
      const bell = await waitForBell(b.principalUuid, 'conversation_assigned')
      expect(bell.title).toBe('You were assigned a conversation')

      // Positive control: a reply sent after the notice reaches the visitor;
      // the notice never does.
      const reply = `Ben will help ${marker}`
      await sendFromComposer(page, reply, 'reply')
      await expect(visitor.page.getByText(reply)).toBeVisible({ timeout: 15_000 })
      await expect(visitor.page.getByText(notice)).toHaveCount(0)
      await visitor.page.context().close()
    }
  )

  test(
    'INB-47 assign to me twice is one notice; unassign clears with no notice',
    {
      tag: '@core',
    },
    async ({ teammate, seed }) => {
      const { page, mate } = await teammate()
      const c = await seed()
      await openConversation(page, c.id, c.messages[0])

      await pick(page, assigneeButton(page, 'Unassigned'), 'Assign to me')
      await waitForConversation(
        c.uuid,
        'the self-assignment',
        (r) => r.assigned_agent_principal_id === mate.principalUuid
      )
      await expect(threadMessages(page, `Conversation assigned to ${mate.name}`)).toBeVisible({
        timeout: 15_000,
      })
      const afterFirst = (await systemNotices(c.uuid)).length

      await pick(page, assigneeButton(page, mate.name), 'Assign to me')
      await page.waitForTimeout(1_000)
      expect((await systemNotices(c.uuid)).length).toBe(afterFirst)
      await expect(threadMessages(page, `Conversation assigned to ${mate.name}`)).toHaveCount(1)

      await pick(page, assigneeButton(page, mate.name), 'Unassign')
      await expect(assigneeButton(page, 'Unassigned')).toBeVisible({ timeout: 15_000 })
      await waitForConversation(
        c.uuid,
        'the unassignment',
        (r) => r.assigned_agent_principal_id === null
      )
      await page.waitForTimeout(1_000)
      expect((await systemNotices(c.uuid)).length).toBe(afterFirst)
    }
  )

  test(
    'INB-50 assigning a team adds a team notice and bells its members except the actor',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const sql = supportDb()
      const { generateId, toUuid } = await import('@quackback/ids')
      const teamId = generateId('team')
      const teamName = `Team ${marker}`
      await sql`INSERT INTO teams (id, name) VALUES (${toUuid(teamId)}, ${teamName})`
      const { page, mate: actor } = await teammate({ teams: [teamId] })
      const { mate: member } = await teammate({ teams: [teamId] })
      const c = await seed()
      await openConversation(page, c.id, c.messages[0])

      // `t` opens the team menu for the open conversation.
      const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
      await expect(async () => {
        await page.locator('body').press('t')
        await expect(bar).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
      await page.getByRole('menuitem', { name: teamName }).click()
      await expect(
        threadMessages(page, `Conversation assigned to the ${teamName} team`)
      ).toBeVisible({
        timeout: 15_000,
      })
      await waitForConversation(c.uuid, 'the team', (r) => r.assigned_team_id === toUuid(teamId))
      const bell = await waitForBell(member.principalUuid, 'conversation_assigned')
      expect(bell.title).toBe('A conversation was assigned to your team')
      await page.waitForTimeout(1_000)
      expect((await bellsFor(actor.principalUuid)).map((b) => b.title)).not.toContain(
        'A conversation was assigned to your team'
      )
    }
  )

  test(
    'INB-54 snoozing until a time moves the thread to Waiting with an internal wake-time notice',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page, mate } = await teammate()
      const c = await seed()
      await openConversation(page, c.id, c.messages[0])

      await pick(
        page,
        page.getByRole('button', { name: 'Snooze', exact: true }).first(),
        'Tomorrow'
      )
      const row = await waitForConversation(c.uuid, 'the snooze', (r) => r.status === 'snoozed')
      expect(row.snoozed_until).not.toBeNull()
      const notice = threadMessages(
        page,
        new RegExp(`${mate.name} snoozed the conversation until \\w{3} \\d+`)
      )
      await expect(notice).toBeVisible({ timeout: 15_000 })
      const [stored] = await systemNotices(c.uuid)
      expect(stored.is_internal).toBe(true)

      await page.goto(inboxUrl({ q: marker }))
      await expect(page.getByText('No conversations match these filters')).toBeVisible({
        timeout: 15_000,
      })
      await page.goto(inboxUrl({ q: marker, status: 'waiting' }))
      await expect(listRows(page, c.visitorName)).toHaveCount(1, { timeout: 15_000 })
    }
  )

  test(
    'INB-55 snoozed until the customer replies: a teammate reply keeps it snoozed, the visitor reply reopens it',
    {
      tag: '@core',
    },
    async ({ teammate, browser, marker }) => {
      test.setTimeout(60_000)
      const { page, mate } = await teammate()
      const visitor = await widgetVisitor(browser, `Ping ${marker}`)
      await openConversation(page, visitor.id, `Ping ${marker}`)

      await pick(
        page,
        page.getByRole('button', { name: 'Snooze', exact: true }).first(),
        'Until they reply'
      )
      await waitForConversation(visitor.uuid, 'the snooze', (r) => r.status === 'snoozed')
      await expect(
        threadMessages(page, `${mate.name} snoozed the conversation until the customer replies`)
      ).toBeVisible({ timeout: 15_000 })

      await sendFromComposer(page, `Checking ${marker}`, 'reply')
      await expect(visitor.page.getByText(`Checking ${marker}`)).toBeVisible({ timeout: 15_000 })
      expect((await conversationState(visitor.uuid)).status).toBe('snoozed')

      const editor = visitor.page.locator('.ProseMirror[contenteditable="true"]')
      await editor.click()
      await editor.fill(`Still broken ${marker}`)
      await visitor.page.getByRole('button', { name: 'Send', exact: true }).click()
      await waitForConversation(visitor.uuid, 'the wake on reply', (r) => r.status === 'open')
      await page.goto(inboxUrl({ q: marker }))
      await expect(listRows(page, marker)).toHaveCount(1, { timeout: 15_000 })
      await visitor.page.context().close()
    }
  )

  test(
    'INB-57 closing moves the thread to Closed and the visitor sees it ended',
    {
      tag: '@core',
    },
    async ({ teammate, browser, marker }) => {
      test.setTimeout(60_000)
      const { page } = await teammate()
      const visitor = await widgetVisitor(browser, `Thanks ${marker}`)
      await openConversation(page, visitor.id, `Thanks ${marker}`)

      await page.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(page.getByText('Conversation closed')).toBeVisible()
      const row = await waitForConversation(visitor.uuid, 'the close', (r) => r.status === 'closed')
      expect(row.snoozed_until).toBeNull()
      await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()
      await expect(visitor.page.getByText('Conversation ended').first()).toBeVisible({
        timeout: 15_000,
      })
      const ended = (await systemNotices(visitor.uuid)).find((m) => m.content.includes('ended'))
      expect(ended?.is_internal).toBe(false)

      await page.goto(inboxUrl({ q: marker, status: 'closed' }))
      await expect(listRows(page, marker)).toHaveCount(1, { timeout: 15_000 })
      await visitor.page.context().close()
    }
  )

  test(
    'INB-59 reopening a closed conversation returns it to the open list',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed({ status: 'closed' })
      await openConversation(page, c.id, c.messages[0])

      await page.getByRole('button', { name: 'Reopen', exact: true }).click()
      await expect(page.getByText('Conversation reopened').first()).toBeVisible()
      await waitForConversation(c.uuid, 'the reopen', (r) => r.status === 'open')
      const reopened = (await systemNotices(c.uuid)).find((m) => m.content.includes('reopened'))
      expect(reopened?.is_internal).toBe(false)
      await page.goto(inboxUrl({ q: marker }))
      await expect(listRows(page, c.visitorName)).toHaveCount(1, { timeout: 15_000 })
    }
  )

  test(
    'INB-64 adding and removing a tag updates the thread and the label filter',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const tag = await seedTag(`Label ${marker}`)
      const c = await seed()
      await openConversation(page, c.id, c.messages[0])

      const panel = detailsPanel(page)
      await panel.getByRole('button', { name: 'Add', exact: true }).click()
      await page.getByPlaceholder('Search or create…').fill(tag.name)
      await page.getByRole('button', { name: tag.name, exact: true }).click()
      await expect(panel.getByRole('button', { name: `Remove ${tag.name}` })).toBeVisible({
        timeout: 15_000,
      })
      await page.keyboard.press('Escape')

      await page.goto(inboxUrl({ tag: tag.id }))
      await expect(listRows(page, c.visitorName)).toHaveCount(1, { timeout: 15_000 })

      await openConversation(page, c.id, c.messages[0])
      await detailsPanel(page)
        .getByRole('button', { name: `Remove ${tag.name}` })
        .click()
      await expect(
        detailsPanel(page).getByRole('button', { name: `Remove ${tag.name}` })
      ).toHaveCount(0, { timeout: 15_000 })
      await page.goto(inboxUrl({ tag: tag.id }))
      await expect(page.getByText(/No conversations|Nothing to review/).first()).toBeVisible({
        timeout: 15_000,
      })
      await expect(listRows(page, c.visitorName)).toHaveCount(0)
    }
  )

  test(
    'INB-68 applying a macro fills the composer and runs its tag, assignee and snooze actions',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const { mate: b } = await teammate()
      const tag = await seedTag(`Macro label ${marker}`)
      const macro = await seedMacro(
        `Refund ${marker}`,
        'Hi {firstName}, about {conversationTitle}{unknown}.',
        [
          { type: 'add_tag', tagId: tag.id },
          { type: 'assign_agent', principalId: b.principalId },
          { type: 'snooze', preset: 'until_reply' },
        ]
      )
      const c = await seed({
        visitorEmail: `${marker}@customers.example`,
        visitorName: `Rita ${marker}`,
        subject: `Refund request ${marker}`,
      })
      await openConversation(page, c.id, c.messages[0])

      await page.getByRole('button', { name: 'Macros' }).click()
      await page.getByPlaceholder('Search macros…').fill(macro.name)
      await page.getByRole('option', { name: new RegExp(macro.name) }).click()
      await expect(page.getByText(/^Applied: /)).toBeVisible({ timeout: 15_000 })
      // Filled in the composer, not sent.
      await expect(page.locator('.ProseMirror').last()).toContainText(
        `Hi Rita, about Refund request ${marker}.`
      )
      expect((await messagesOf(c.uuid)).filter((m) => m.sender_type === 'agent')).toHaveLength(0)
      const state = await waitForConversation(
        c.uuid,
        'the macro actions',
        (r) => r.assigned_agent_principal_id === b.principalUuid && r.status === 'snoozed'
      )
      expect(state.snoozed_until).toBeNull()
      await expect(
        detailsPanel(page).getByRole('button', { name: `Remove ${tag.name}` })
      ).toBeVisible({
        timeout: 15_000,
      })
    }
  )

  test(
    'INB-84 starting an outbound conversation emails the customer and lists it under Created by me',
    {
      tag: '@core',
    },
    async ({ teammate, seed, customerEmail, marker }) => {
      const { page } = await teammate()
      // An identified customer (a portal user with an email) to write to.
      await seed({ visitorEmail: customerEmail, visitorName: `Olive ${marker}`, status: 'closed' })

      await page.goto('/admin/inbox')
      await expect(async () => {
        await page.getByRole('button', { name: 'New conversation' }).click()
        await expect(page.getByRole('dialog', { name: 'New conversation' })).toBeVisible({
          timeout: 2_000,
        })
      }).toPass({ timeout: 15_000 })
      const dialog = page.getByRole('dialog', { name: 'New conversation' })
      await dialog.getByPlaceholder('Search users by name or email…').fill(customerEmail)
      await dialog.getByText(customerEmail).first().click()
      const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
      await editor.click()
      await editor.pressSequentially(`We noticed an issue ${marker}`)
      await dialog.getByRole('button', { name: 'Send message' }).click()
      await expect(page.getByText('Message sent')).toBeVisible({ timeout: 15_000 })

      const mail = await waitForMail({ to: customerEmail, timeoutMs: 30_000 })
      expect(mail.Text).toContain(`We noticed an issue ${marker}`)
      await page.goto(inboxUrl({ view: 'created_by_me' }))
      await expect(listRows(page, `Olive ${marker}`)).toHaveCount(1, { timeout: 15_000 })
      await expect(listRows(page, marker)).toHaveCount(1)
    }
  )

  test(
    'INB-90 setting Away saves the availability and keeps the teammate out of team routing',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const sql = supportDb()
      const { generateId, toUuid } = await import('@quackback/ids')
      const teamId = generateId('team')
      await sql`INSERT INTO teams (id, name, assignment_method)
              VALUES (${toUuid(teamId)}, ${`RR ${marker}`}, 'round_robin')`
      const { page, mate } = await teammate({ teams: [teamId] })
      const { page: lead } = await teammate()

      // The teammate is online: the inbox page's own stream holds presence.
      await page.goto('/admin/inbox')
      const account = page.getByRole('button', { name: mate.name }).first()
      await pick(page, account, 'Set yourself as away')
      await expect
        .poll(async () => {
          const [row] = await sql<{ chat_availability: string }[]>`
          SELECT chat_availability FROM principal WHERE id = ${mate.principalUuid}`
          return row.chat_availability
        })
        .toBe('away')

      // A team assignment skips the Away member: the conversation gets the team only.
      const c = await seed()
      await openConversation(lead, c.id, c.messages[0])
      await expect(async () => {
        await lead.locator('body').press('t')
        await expect(lead.getByRole('menuitem', { name: `RR ${marker}` })).toBeVisible({
          timeout: 2_000,
        })
      }).toPass({ timeout: 15_000 })
      await lead.getByRole('menuitem', { name: `RR ${marker}` }).click()
      const state = await waitForConversation(
        c.uuid,
        'the team',
        (r) => r.assigned_team_id !== null
      )
      expect(state.assigned_agent_principal_id).toBeNull()

      // Back to active: the next team assignment lands on the teammate.
      await pick(page, account, 'Set yourself as active')
      await expect
        .poll(async () => {
          const [row] = await sql<{ chat_availability: string }[]>`
          SELECT chat_availability FROM principal WHERE id = ${mate.principalUuid}`
          return row.chat_availability
        })
        .toBe('online')
      const next = await seed({ visitorName: `Next ${marker}` })
      await openConversation(lead, next.id, next.messages[0])
      await expect(async () => {
        await lead.locator('body').press('t')
        await expect(lead.getByRole('menuitem', { name: `RR ${marker}` })).toBeVisible({
          timeout: 2_000,
        })
      }).toPass({ timeout: 15_000 })
      await lead.getByRole('menuitem', { name: `RR ${marker}` }).click()
      await waitForConversation(
        next.uuid,
        'the routed member',
        (r) => r.assigned_agent_principal_id === mate.principalUuid
      )
    }
  )

  test(
    'INB-49 reassigning a snoozed conversation to someone else wakes it',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const { mate: b } = await teammate({ name: `Bo ${marker.slice(-6)}` })
      const c = await seed({ status: 'snoozed', snoozedUntil: new Date(Date.now() + 86_400_000) })
      await openConversation(page, c.id, c.messages[0])
      await pick(page, assigneeButton(page, 'Unassigned'), b.name)
      const state = await waitForConversation(c.uuid, 'the wake', (r) => r.status === 'open')
      expect(state.assigned_agent_principal_id).toBe(b.principalUuid)
      expect(state.snoozed_until).toBeNull()
    }
  )

  test(
    'INB-53 setting priority updates the thread and the priority filter',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed()
      await openConversation(page, c.id, c.messages[0])
      await pick(page, detailsPanel(page).getByRole('button', { name: 'Priority' }), 'High')
      await expect(detailsPanel(page).getByRole('button', { name: 'High' })).toBeVisible({
        timeout: 15_000,
      })
      await waitForConversation(c.uuid, 'the priority', (r) => r.priority === 'high')
      await page.goto(inboxUrl({ q: marker, priority: 'high' }))
      await expect(listRows(page, c.visitorName)).toHaveCount(1, { timeout: 15_000 })
      await page.goto(inboxUrl({ q: marker, priority: 'low' }))
      await expect(listRows(page, c.visitorName)).toHaveCount(0, { timeout: 15_000 })
    }
  )

  test(
    'INB-56 the snooze sweep reopens a conversation whose wake time passed',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, request, marker }) => {
      const { page } = await teammate()
      // Backdated wake time: the sweep at the wall clock picks it up.
      const c = await seed({ status: 'snoozed', snoozedUntil: new Date(Date.now() - 60_000) })
      await runSweep(request, 'snooze-sweep')
      await waitForConversation(c.uuid, 'the wake', (r) => r.status === 'open')
      await page.goto(inboxUrl({ q: marker }))
      await expect(listRows(page, c.visitorName)).toHaveCount(1, { timeout: 15_000 })
    }
  )

  test(
    'INB-60 ending a conversation with a reason closes it and records the reason',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed }) => {
      const { page } = await teammate()
      const c = await seed()
      await openConversation(page, c.id, c.messages[0])
      await page.getByRole('button', { name: 'More conversation actions' }).click()
      await page.getByRole('menuitem', { name: 'End conversation' }).click()
      const dialog = page.getByRole('dialog', { name: 'End conversation' })
      await dialog.getByRole('radio', { name: 'Duplicate / already handled' }).click()
      await dialog.getByLabel('Note (optional)').fill('Same as last week')
      await dialog.getByRole('button', { name: 'End conversation' }).click()
      const state = await waitForConversation(c.uuid, 'the end', (r) => r.status === 'closed')
      expect(state.end_reason).toBe('duplicate')
      const [row] = await supportDb()<{ end_note: string | null }[]>`
      SELECT end_note FROM conversations WHERE id = ${c.uuid}`
      expect(row.end_note).toBe('Same as last week')
    }
  )

  test(
    'INB-61 restoring from spam returns the thread to the open list and out of Spam',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed({ status: 'closed', endReason: 'spam', spamReason: 'burst_rate' })
      await openConversation(page, c.id, c.messages[0], { view: 'spam' })
      await pick(
        page,
        detailsPanel(page).getByRole('button', { name: 'Spam', exact: true }),
        'Restore from spam'
      )
      await expect(page.getByText('Conversation restored from spam').first()).toBeVisible()
      const state = await waitForConversation(c.uuid, 'the restore', (r) => r.status === 'open')
      expect(state.end_reason).toBeNull()
      await page.goto(inboxUrl({ q: marker }))
      await expect(listRows(page, c.visitorName)).toHaveCount(1, { timeout: 15_000 })
      await page.goto(inboxUrl({ q: marker, view: 'spam' }))
      await expect(page.getByText('No conversations match these filters')).toBeVisible({
        timeout: 15_000,
      })
    }
  )

  test(
    'INB-63 delete forever removes a spam conversation for good',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed({ status: 'closed', endReason: 'spam', spamReason: 'burst_rate' })
      await page.goto(inboxUrl({ q: marker, view: 'spam' }))
      const row = listRows(page, c.visitorName)
      await expect(async () => {
        await row.getByRole('button').first().click()
        await expect(page).toHaveURL(new RegExp(`i=${c.id}`), { timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
      const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
      await expect(async () => {
        await page.getByRole('heading', { level: 2 }).first().click()
        await page.keyboard.press('x')
        await expect(bar).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
      await bar.getByRole('button', { name: 'Delete forever' }).click()
      await page.getByRole('button', { name: 'Delete permanently' }).click()
      await expect
        .poll(
          async () => (await supportDb()`SELECT 1 FROM conversations WHERE id = ${c.uuid}`).length
        )
        .toBe(0)
      await expect(row).toHaveCount(0, { timeout: 15_000 })
    }
  )

  test(
    'INB-65 inline label create needs manage_tags: refused with only set_tags, created and applied with it',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, people, marker }) => {
      const sql = supportDb()
      const createInline = async (page: Page, name: string) => {
        await detailsPanel(page).getByRole('button', { name: 'Add', exact: true }).click()
        await page.getByPlaceholder('Search or create…').fill(name)
        await page.getByRole('button', { name: new RegExp(`Create “${name}”`) }).click()
      }
      const tagRows = (name: string) => sql`SELECT 1 FROM conversation_tags WHERE name = ${name}`

      const { page: scoped } = await teammate({
        role: 'e2e_scoped_agent',
        teams: [people.teams.billing],
      })
      const c = await seed({ team: people.teams.billing })
      await openConversation(scoped, c.id, c.messages[0])
      const refused = `Refused label ${marker}`
      await createInline(scoped, refused)
      await expect(scoped.getByText('Failed to add tag')).toBeVisible({ timeout: 15_000 })
      expect(await tagRows(refused)).toHaveLength(0)

      const { page: admin } = await teammate()
      await openConversation(admin, c.id, c.messages[0])
      const created = `New label ${marker}`
      await createInline(admin, created)
      await expect(
        detailsPanel(admin).getByRole('button', { name: `Remove ${created}` })
      ).toBeVisible({ timeout: 15_000 })
      const [tagged] = await sql`
        SELECT 1 FROM conversation_tag_assignments a JOIN conversation_tags t ON t.id = a.conversation_tag_id
        WHERE a.conversation_id = ${c.uuid} AND t.name = ${created}`
      expect(tagged).toBeTruthy()
    }
  )

  test(
    'INB-79 tracking a conversation as a feedback post creates the post and links it',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed({
        subject: `Dark mode please ${marker}`,
        messages: [`I would love a dark mode ${marker}`],
      })
      await openConversation(page, c.id, c.messages[0])
      await detailsPanel(page).getByRole('button', { name: 'Track as feedback' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.locator('#convert-title')).toHaveValue(`Dark mode please ${marker}`)
      await dialog.getByRole('button', { name: 'Track as feedback' }).click()
      await expect(page.getByText(/Post created from conversation/)).toBeVisible({
        timeout: 15_000,
      })
      await expect(
        page.getByRole('heading', { level: 3, name: `Dark mode please ${marker}` })
      ).toBeVisible({
        timeout: 15_000,
      })
      const [post] =
        await supportDb()`SELECT id FROM posts WHERE title = ${`Dark mode please ${marker}`}`
      expect(post).toBeTruthy()
    }
  )

  test(
    'INB-82 exporting a transcript downloads the thread',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed({ messages: [`Transcript line ${marker}`] })
      await openConversation(page, c.id, c.messages[0])
      await page.getByRole('button', { name: 'More conversation actions' }).click()
      const downloading = page.waitForEvent('download')
      await page.getByRole('menuitem', { name: 'Export transcript' }).click()
      const download = await downloading
      const path = await download.path()
      const { readFileSync } = await import('node:fs')
      expect(readFileSync(path, 'utf8')).toContain(`Transcript line ${marker}`)
    }
  )

  test(
    'INB-51 a round-robin team assignment lands on an online member and skips Away ones',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const teamName = `Rotation ${marker}`
      const teamId = await seedTeam(teamName, 'round_robin')
      const { page: lead } = await teammate()
      const { mate: online } = await teammate({ teams: [teamId] })
      const { mate: away } = await teammate({ teams: [teamId] })
      await supportDb()`UPDATE principal SET chat_availability = 'away' WHERE id = ${away.principalUuid}`
      const held = [await holdPresenceFor(online.cookie), await holdPresenceFor(away.cookie)]
      try {
        for (const name of ['First', 'Second']) {
          const c = await seed({ visitorName: `${name} ${marker}` })
          await openConversation(lead, c.id, c.messages[0])
          await assignTeamByKeyboard(lead, teamName)
          await waitForConversation(
            c.uuid,
            `${name} lands on the online member`,
            (r) => r.assigned_agent_principal_id === online.principalUuid
          )
        }
      } finally {
        for (const h of held) h.release()
      }
    }
  )

  test(
    'INB-91 when a teammate goes offline their unanswered threads go back to the queue',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      test.setTimeout(90_000)
      const { mate } = await teammate()
      const unanswered = await seed({
        assignee: mate.principalId,
        visitorName: `Waiting ${marker}`,
      })
      const snoozed = await seed({
        assignee: mate.principalId,
        status: 'snoozed',
        snoozedUntil: new Date(Date.now() + 86_400_000),
        visitorName: `Snoozed ${marker}`,
      })
      const held = await holdPresenceFor(mate.cookie)
      await expect
        .poll(
          async () =>
            (
              await supportDb()`SELECT 1 FROM presence_stream WHERE principal_id = ${mate.principalId}`
            ).length
        )
        .toBeGreaterThan(0)
      held.release()
      await waitForConversation(
        unanswered.uuid,
        'the requeue',
        (r) => r.assigned_agent_principal_id === null,
        75_000
      )
      expect((await conversationState(snoozed.uuid)).assigned_agent_principal_id).toBe(
        mate.principalUuid
      )
    }
  )
})
