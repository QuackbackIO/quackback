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
import { fakeAi } from '../../support/fake-ai-client'
import { waitForMail } from '../../support/mailpit'
import { createSupportApiKey } from '../../utils/db-helpers'
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
  threadMessages,
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
      await expect(threadMessages(page, reply)).toBeVisible()
      await waitForConversation(
        c.uuid,
        'the claim',
        (r) => r.assigned_agent_principal_id === mate.principalUuid
      )
      await expect(detailsPanel(page).getByRole('button', { name: mate.name })).toBeVisible()
      // A claim writes no "Conversation assigned to" system notice.
      await page.reload()
      await expect(threadMessages(page, reply)).toBeVisible({ timeout: 15_000 })
      await expect(threadMessages(page, /Conversation assigned to/)).toHaveCount(0)
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
      await expect(threadMessages(page, note)).toBeVisible({ timeout: 15_000 })
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
      await expect(threadMessages(page, `please check ${marker}`)).toBeVisible({ timeout: 15_000 })

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
      await expect(threadMessages(page, `note ${marker}`)).toBeVisible({ timeout: 15_000 })
      // Nothing reached the blocked teammate.
      await page.waitForTimeout(2_000)
      expect((await bellsFor(blocked.principalUuid)).map((b) => b.type)).not.toContain(
        'chat_mention'
      )
    }
  )

  test(
    'INB-42 the author edits a reply and the visitor sees the edit',
    {
      tag: '@nightly',
    },
    async ({ teammate, browser, marker }) => {
      test.setTimeout(60_000)
      const { page } = await teammate()
      const { page: other } = await teammate()
      const visitor = await widgetVisitor(browser, `Edit me ${marker}`)
      await openConversation(page, visitor.id, `Edit me ${marker}`)
      await sendFromComposer(page, `Typo reply ${marker}`, 'reply')
      await expect(visitor.page.getByText(`Typo reply ${marker}`)).toBeVisible({ timeout: 15_000 })
      const replyId = await agentMessageId(visitor.uuid)

      const bubble = page.locator(`[data-message-id="${replyId}"]`)
      await bubble.hover()
      await bubble.getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: 'Edit message' }).click()
      const editor = bubble.locator('.ProseMirror[contenteditable="true"]')
      await editor.fill(`Fixed reply ${marker}`)
      await bubble.getByRole('button', { name: 'Save changes' }).click()
      await expect(bubble).toContainText(`Fixed reply ${marker}`, { timeout: 15_000 })
      await expect(bubble).toContainText('(edited)')
      await expect(visitor.page.getByText(`Fixed reply ${marker}`)).toBeVisible({ timeout: 15_000 })

      // Another teammate sees the edit but is not offered Edit on it.
      await openConversation(other, visitor.id, `Edit me ${marker}`)
      const otherBubble = other.locator(`[data-message-id="${replyId}"]`)
      await expect(otherBubble).toContainText(`Fixed reply ${marker}`)
      await otherBubble.hover()
      await otherBubble.getByRole('button', { name: 'More actions' }).click()
      await expect(other.getByRole('menuitem', { name: 'Mark unread' })).toBeVisible()
      await expect(other.getByRole('menuitem', { name: 'Edit message' })).toHaveCount(0)
      await visitor.page.context().close()
    }
  )

  test(
    'INB-43 deleting a public reply removes it for teammate and visitor',
    {
      tag: '@nightly',
    },
    async ({ teammate, browser, marker }) => {
      test.setTimeout(60_000)
      const { page } = await teammate()
      const visitor = await widgetVisitor(browser, `Delete test ${marker}`)
      await openConversation(page, visitor.id, `Delete test ${marker}`)
      await sendFromComposer(page, `Wrong answer ${marker}`, 'reply')
      await expect(visitor.page.getByText(`Wrong answer ${marker}`)).toBeVisible({
        timeout: 15_000,
      })
      const replyId = await agentMessageId(visitor.uuid)

      const bubble = page.locator(`[data-message-id="${replyId}"]`)
      await bubble.hover()
      await bubble.getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()
      await expect(bubble).toHaveCount(0, { timeout: 15_000 })
      await expect(visitor.page.getByText(`Wrong answer ${marker}`)).toHaveCount(0, {
        timeout: 15_000,
      })
      const deleted = (await messagesOf(visitor.uuid)).find((m) => m.sender_type === 'agent')
      expect(deleted?.deleted_at).not.toBeNull()
      await visitor.page.context().close()
    }
  )

  test(
    'INB-44 two teammates react to a message and both see the counts live',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page: a } = await teammate()
      const { page: b } = await teammate()
      const c = await seed({ messages: [`React to me ${marker}`] })
      await openConversation(a, c.id, c.messages[0])
      await openConversation(b, c.id, c.messages[0])
      const bubbleA = a.locator(`[data-message-id="${c.messageIds[0]}"]`)
      const bubbleB = b.locator(`[data-message-id="${c.messageIds[0]}"]`)
      const count = (n: number) => new RegExp(`👍\\s*${n}`)

      await bubbleA.hover()
      await bubbleA.getByRole('button', { name: 'Add reaction' }).click()
      await a.getByRole('button', { name: 'React with 👍' }).click()
      await expect(bubbleA.getByRole('button', { name: count(1) })).toBeVisible({ timeout: 15_000 })
      await expect(bubbleB.getByRole('button', { name: count(1) })).toBeVisible({ timeout: 15_000 })

      await bubbleB.getByRole('button', { name: count(1) }).click()
      await expect(bubbleB.getByRole('button', { name: count(2) })).toBeVisible({ timeout: 15_000 })
      await expect(bubbleA.getByRole('button', { name: count(2) })).toBeVisible({ timeout: 15_000 })
    }
  )

  test(
    'INB-45 flagging a message saves it to Saved messages and unflagging removes it',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed({ messages: [`Flag me ${marker}`, `newest ${marker}`] })
      await openConversation(page, c.id, c.messages[0])
      const bubble = page.locator(`[data-message-id="${c.messageIds[0]}"]`)
      await bubble.hover()
      await bubble.getByRole('button', { name: 'Flag message' }).click()
      await expect(bubble.getByRole('button', { name: 'Remove flag' })).toBeAttached({
        timeout: 15_000,
      })

      await page.goto('/admin/inbox?view=saved')
      await expect(page.getByText(`Flag me ${marker}`)).toBeVisible({ timeout: 15_000 })
      await openConversation(page, c.id, c.messages[0])
      await bubble.hover()
      await bubble.getByRole('button', { name: 'Remove flag' }).click()
      await expect(bubble.getByRole('button', { name: 'Flag message' })).toBeAttached({
        timeout: 15_000,
      })
      await page.goto('/admin/inbox?view=saved')
      await expect(
        page.getByText('Nothing saved yet. Flag a message to find it here.')
      ).toBeVisible({
        timeout: 15_000,
      })
    }
  )

  test(
    'INB-87 typing in the inbox shows the visitor and a second teammate a typing indicator that clears',
    {
      tag: '@nightly',
    },
    async ({ teammate, browser, marker }) => {
      test.setTimeout(60_000)
      const { page } = await teammate()
      const { page: other } = await teammate()
      const visitor = await widgetVisitor(browser, `Typing ${marker}`)
      await openConversation(page, visitor.id, `Typing ${marker}`)
      await openConversation(other, visitor.id, `Typing ${marker}`)

      const dots = visitor.page.locator('span.animate-bounce')
      await expect(dots).toHaveCount(0)
      await composer(page).click()
      await composer(page).pressSequentially('Let me check', { delay: 50 })
      await expect(dots.first()).toBeVisible({ timeout: 10_000 })
      await expect(other.getByText('Another agent is replying…')).toBeVisible({ timeout: 10_000 })
      // About 4 s without a keystroke and the indicator is gone.
      await expect(dots).toHaveCount(0, { timeout: 10_000 })
      await expect(other.getByText('Another agent is replying…')).toHaveCount(0, {
        timeout: 10_000,
      })
      await visitor.page.context().close()
    }
  )

  test(
    'INB-88 reply and note drafts are kept apart per mode',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed()
      await openConversation(page, c.id, c.messages[0])

      await composer(page).click()
      await composer(page).fill(`reply draft ${marker}`)
      await setComposerMode(page, 'note')
      await expect(composer(page)).not.toContainText(`reply draft ${marker}`)
      await composer(page).click()
      await composer(page).fill(`note draft ${marker}`)
      await setComposerMode(page, 'reply')
      await expect(composer(page)).toContainText(`reply draft ${marker}`)
      await setComposerMode(page, 'note')
      await expect(composer(page)).toContainText(`note draft ${marker}`)
    }
  )

  test(
    'INB-89 the Copilot tab answers a question from the model',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed()
      const answer = `Refunds take five days ${marker}`
      await fakeAi.script({ marker: `ask-${marker}`, reply: answer })
      await openConversation(page, c.id, c.messages[0])

      await detailsPanel(page).getByRole('tab', { name: 'Copilot' }).click()
      const ask = page.getByPlaceholder('Ask a question...')
      await ask.fill(`How long do refunds take? ask-${marker}`)
      await page.getByRole('button', { name: 'Ask', exact: true }).click()
      await expect(page.getByText(answer)).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: 'Good answer' })).toBeVisible()
      await expect(page.getByPlaceholder('Ask a follow-up question...')).toBeVisible()
      await fakeAi.waitForRequests({ contains: `ask-${marker}` })
    }
  )

  test(
    'INB-93 a personal API key reply shows the creator to teammates and the customer',
    {
      tag: '@nightly',
    },
    async ({ teammate, browser, request, marker }) => {
      test.setTimeout(60_000)
      const { page, mate } = await teammate({ name: `Kim ${marker.slice(-6)}` })
      const visitor = await widgetVisitor(browser, `Via API ${marker}`)
      const key = createSupportApiKey(mate.email, 'personal')
      const res = await request.post(`/api/v1/conversations/${visitor.id}/reply`, {
        headers: { authorization: `Bearer ${key}` },
        data: { content: `From the API ${marker}` },
      })
      expect(res.status(), await res.text()).toBeLessThan(300)

      await expect(visitor.page.getByText(`From the API ${marker}`)).toBeVisible({
        timeout: 15_000,
      })
      await openConversation(page, visitor.id, `Via API ${marker}`)
      const replyId = await agentMessageId(visitor.uuid)
      await expect(page.locator(`[data-message-id="${replyId}"]`)).toContainText(mate.name)
      await expect(visitor.page.getByText(mate.name.split(' ')[0]).first()).toBeVisible()
      await visitor.page.context().close()
    }
  )
})

/** The TypeID of the conversation's first agent message. */
async function agentMessageId(conversationUuid: string): Promise<string> {
  const { fromUuid } = await import('@quackback/ids')
  const reply = await pollFor('an agent message', async () =>
    (await messagesOf(conversationUuid)).find((m) => m.sender_type === 'agent')
  )
  return fromUuid('conversation_msg', reply.id)
}
