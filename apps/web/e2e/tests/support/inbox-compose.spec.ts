/**
 * Support inbox composer: public replies, notes, mentions and message
 * actions (journeys INB-32..INB-45, INB-87..INB-89, INB-93).
 *
 * The customer side is observed in the widget (anonymous visitor, live) or in
 * Mailpit (identified visitor, offline). Every "the customer never sees it"
 * check is paired with a public reply sent after it that the customer does
 * see, so the absence is not just a slow page.
 */
import { pollFor } from '../../support/db'
import { waitForMail } from '../../support/mailpit'
import {
  test,
  expect,
  bellsFor,
  composer,
  conversationState,
  conversationTypeId,
  conversationWithMessage,
  detailsPanel,
  messagesOf,
  openConversation,
  sendFromComposer,
  setComposerMode,
  waitForConversation,
  widgetStartConversation,
} from '../../support/inbox'

test.use({ viewport: { width: 1920, height: 1080 } })

/** An anonymous visitor who started a conversation in the widget. */
async function widgetVisitor(browser: import('@playwright/test').Browser, text: string) {
  const page = await (await browser.newContext()).newPage()
  await widgetStartConversation(page, text)
  const uuid = await conversationWithMessage(text)
  return { page, uuid, id: conversationTypeId(uuid) }
}

test.describe('inbox composer', () => {
  test(
    'INB-32 a public reply reaches the widget live and an offline visitor by email',
    {
      tag: '@smoke',
    },
    async ({ teammate, browser, seed, customerEmail, marker }) => {
      test.setTimeout(45_000)
      const { page, mate } = await teammate()
      const visitor = await widgetVisitor(browser, `Where is my order ${marker}?`)

      await openConversation(page, visitor.id, `Where is my order ${marker}?`)
      const reply = `It ships today ${marker}`
      await sendFromComposer(page, reply, 'reply')
      await expect(visitor.page.getByText(reply)).toBeVisible({ timeout: 15_000 })
      const [, agentMessage] = await messagesOf(visitor.uuid)
      expect(agentMessage).toMatchObject({
        sender_type: 'agent',
        is_internal: false,
        content: reply,
      })
      const state = await conversationState(visitor.uuid)
      expect(state.waiting_since).toBeNull()
      expect(state.last_message_preview).toBe(reply)

      // An identified visitor with no open stream gets the reply by email.
      const offline = await seed({ visitorEmail: customerEmail })
      await openConversation(page, offline.id, offline.messages[0])
      const mailed = `Mailed answer ${marker}`
      await sendFromComposer(page, mailed, 'reply')
      const mail = await waitForMail({ to: customerEmail })
      expect(mail.Text).toContain(mailed)
      expect(mail.Text + mail.HTML).toContain(mate.name.split(' ')[0])
      await visitor.page.context().close()
    }
  )

  test(
    'INB-33 replying claims an unassigned conversation with no assignment notice; a scoped teammate cannot reach another team',
    {
      tag: '@core',
    },
    async ({ teammate, seed, people, marker }) => {
      const { page, mate } = await teammate()
      const c = await seed()
      await openConversation(page, c.id, c.messages[0])
      await expect(detailsPanel(page).getByRole('button', { name: 'Unassigned' })).toBeVisible()
      const reply = `On it ${marker}`
      await sendFromComposer(page, reply, 'reply')
      await expect(page.getByText(reply, { exact: true })).toBeVisible()
      await waitForConversation(
        c.uuid,
        'the claim',
        (r) => r.assigned_agent_principal_id === mate.principalUuid
      )
      await expect(detailsPanel(page).getByRole('button', { name: mate.name })).toBeVisible()
      // A claim writes no "Conversation assigned to" system notice.
      await page.reload()
      await expect(page.getByText(reply, { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/Conversation assigned to/)).toHaveCount(0)
      expect((await messagesOf(c.uuid)).filter((m) => m.sender_type === 'system')).toHaveLength(0)

      // A scoped (Billing) teammate cannot open or answer a Support conversation,
      // but can claim one with no team and no assignee.
      const { page: scoped, mate: scopedMate } = await teammate({
        role: 'e2e_scoped_agent',
        teams: [people.teams.billing],
      })
      const other = await seed({ team: people.teams.support, visitorName: `Other ${marker}` })
      await scoped.goto(`/admin/inbox?i=${other.id}`)
      await expect(scoped.getByText('Conversation not found')).toBeVisible({ timeout: 15_000 })
      await expect(scoped.getByText(other.messages[0])).toHaveCount(0)

      const free = await seed({ visitorName: `Free ${marker}` })
      await openConversation(scoped, free.id, free.messages[0])
      await sendFromComposer(scoped, `Scoped answer ${marker}`, 'reply')
      await waitForConversation(
        free.uuid,
        'the scoped claim',
        (r) => r.assigned_agent_principal_id === scopedMate.principalUuid
      )
      expect((await conversationState(other.uuid)).assigned_agent_principal_id).toBeNull()
    }
  )

  test(
    'INB-34 a reply with an attachment and bold text renders for teammate and visitor',
    {
      tag: '@core',
    },
    async ({ teammate, browser, marker }) => {
      test.setTimeout(60_000)
      const { page } = await teammate()
      const visitor = await widgetVisitor(browser, `Send me the invoice ${marker}`)
      await openConversation(page, visitor.id, `Send me the invoice ${marker}`)

      const fileName = `invoice-${marker}.txt`
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: fileName,
          mimeType: 'text/plain',
          buffer: Buffer.from(`invoice for ${marker}`),
        })
      await expect(page.getByText(fileName).first()).toBeVisible({ timeout: 15_000 })
      const editor = composer(page)
      await editor.click()
      await editor.pressSequentially('Here it is ')
      await page.keyboard.press('ControlOrMeta+b')
      await editor.pressSequentially(`bold ${marker}`)
      await page.getByRole('button', { name: 'Send reply' }).click()

      const bold = page.locator('strong', { hasText: `bold ${marker}` })
      await expect(bold.first()).toBeVisible({ timeout: 15_000 })
      await expect(
        visitor.page.locator('strong', { hasText: `bold ${marker}` }).first()
      ).toBeVisible({ timeout: 15_000 })
      await expect(visitor.page.getByText(fileName).first()).toBeVisible()
      const agent = (await messagesOf(visitor.uuid)).find((m) => m.sender_type === 'agent')
      expect(agent?.content).toContain(`bold ${marker}`)
      await visitor.page.context().close()
    }
  )

  test(
    'INB-39 an internal note shows to teammates and never reaches the visitor',
    {
      tag: '@core',
    },
    async ({ teammate, browser, marker }) => {
      test.setTimeout(60_000)
      const { page } = await teammate()
      const visitor = await widgetVisitor(browser, `Hello ${marker}`)
      await openConversation(page, visitor.id, `Hello ${marker}`)

      await setComposerMode(page, 'note')
      const note = `Customer is on the old plan ${marker}`
      await sendFromComposer(page, note, 'note')
      await expect(page.getByText(note, { exact: true })).toBeVisible({ timeout: 15_000 })
      const before = await conversationState(visitor.uuid)
      expect(before.last_message_preview).toBe(`Hello ${marker}`)
      const noteRow = (await messagesOf(visitor.uuid)).find((m) => m.content === note)
      expect(noteRow?.is_internal).toBe(true)

      // Positive control: a public reply sent after the note reaches the widget,
      // and the note still does not, live or after a reload.
      await setComposerMode(page, 'reply')
      const reply = `Public answer ${marker}`
      await sendFromComposer(page, reply, 'reply')
      await expect(visitor.page.getByText(reply)).toBeVisible({ timeout: 15_000 })
      await expect(visitor.page.getByText(note)).toHaveCount(0)
      await visitor.page.reload()
      await visitor.page.getByRole('button', { name: 'Messages', exact: true }).click()
      await visitor.page.getByText(reply).first().click()
      await expect(visitor.page.getByText(`Hello ${marker}`)).toBeVisible({ timeout: 15_000 })
      await expect(visitor.page.getByText(reply)).toBeVisible()
      await expect(visitor.page.getByText(note)).toHaveCount(0)
      await visitor.page.context().close()
    }
  )

  test(
    'INB-40 mentioning a teammate in a note gives them a bell and a mention email',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page, mate: author } = await teammate()
      const { mate: target } = await teammate({ name: `Mia ${marker.slice(-6)}` })
      const c = await seed()
      await openConversation(page, c.id, c.messages[0])

      await setComposerMode(page, 'note')
      const editor = composer(page)
      await editor.click()
      await editor.pressSequentially('@Mia')
      await page.getByRole('option', { name: new RegExp(target.name) }).click()
      await editor.pressSequentially(` please check ${marker}`)
      await page.getByRole('button', { name: 'Add note' }).click()
      await expect(page.getByText(`please check ${marker}`)).toBeVisible({ timeout: 15_000 })

      const bell = await pollFor(
        'the mention bell',
        async () => (await bellsFor(target.principalUuid)).find((b) => b.type === 'chat_mention'),
        { timeoutMs: 15_000 }
      )
      expect(bell.title).toBe(`${author.name} mentioned you in a conversation`)
      expect(bell.body).toContain(`please check ${marker}`)
      const mail = await waitForMail({ to: target.email })
      expect(mail.Subject + mail.Text).toContain(author.name)
      expect(mail.HTML).toContain(c.id)
      // The author is never notified about their own note.
      expect(
        (await bellsFor(author.principalUuid)).filter((b) => b.type === 'chat_mention')
      ).toEqual([])
    }
  )

  test(
    'INB-41 a teammate who cannot see the conversation shows muted with No access and cannot be picked',
    {
      tag: '@core',
    },
    async ({ teammate, seed, people, marker }) => {
      const { page } = await teammate()
      const suffix = marker.slice(-6)
      const { mate: blocked } = await teammate({
        role: 'e2e_scoped_agent',
        teams: [people.teams.billing],
        name: `Nell ${suffix}`,
      })
      const { mate: allowed } = await teammate({ name: `Nora ${suffix}` })
      const c = await seed({ team: people.teams.support })
      await openConversation(page, c.id, c.messages[0])

      await setComposerMode(page, 'note')
      const editor = composer(page)
      await editor.click()
      await editor.pressSequentially(`@N`)
      const blockedOption = page.getByRole('option', { name: new RegExp(blocked.name) })
      const allowedOption = page.getByRole('option', { name: new RegExp(allowed.name) })
      await expect(blockedOption).toBeVisible()
      await expect(blockedOption).toContainText('No access')
      await expect(blockedOption).toHaveAttribute('aria-disabled', 'true')
      await expect(allowedOption).not.toContainText('No access')
      const chips = page.locator('.ProseMirror .mention')
      await blockedOption.click({ force: true })
      // The click picked nothing: no mention chip, the picker stays open.
      await expect(blockedOption).toBeVisible()
      await expect(chips).toHaveCount(0)
      // Narrowed to the blocked teammate alone, Enter picks nothing either.
      await editor.pressSequentially('ell')
      await expect(allowedOption).toHaveCount(0)
      await expect(blockedOption).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(chips).toHaveCount(0)
      await page.keyboard.press('Escape')
      await editor.pressSequentially(` note ${marker}`)
      await page.getByRole('button', { name: 'Add note' }).click()
      await expect(page.getByText(`note ${marker}`)).toBeVisible({ timeout: 15_000 })
      // Nothing reached the blocked teammate.
      await page.waitForTimeout(2_000)
      expect(await bellsFor(blocked.principalUuid)).toEqual([])
    }
  )
})
