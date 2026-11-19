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
  systemNotices,
  waitForBell,
  waitForConversation,
  widgetStartConversation,
} from '../../support/inbox'
import { supportDb } from '../../support/db'

test.use({ viewport: { width: 1920, height: 1080 } })

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
      await expect(page.getByText(notice)).toBeVisible({ timeout: 15_000 })
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
      await expect(page.getByText(`Conversation assigned to ${mate.name}`)).toBeVisible({
        timeout: 15_000,
      })
      const afterFirst = (await systemNotices(c.uuid)).length

      await pick(page, assigneeButton(page, mate.name), 'Assign to me')
      await page.waitForTimeout(1_000)
      expect((await systemNotices(c.uuid)).length).toBe(afterFirst)
      await expect(page.getByText(`Conversation assigned to ${mate.name}`)).toHaveCount(1)

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
      await expect(page.getByText(`Conversation assigned to the ${teamName} team`)).toBeVisible({
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
      const notice = page.getByText(
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
        page.getByText(`${mate.name} snoozed the conversation until the customer replies`)
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

      const mail = await waitForMail({ to: customerEmail })
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
})
