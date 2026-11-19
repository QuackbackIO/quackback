/**
 * Widget messenger attachments, interactive blocks and CSAT (area CUS-W).
 *
 * Blocks are posted by workflows. A new-conversation workflow would fire for
 * every other test's conversations, so each test seeds its own block message
 * (an agent message carrying `metadata.block`, as a workflow's send_block node
 * writes it) and drives the customer's side of it through the real widget.
 */
import { fromUuid, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import {
  agentApi,
  composer,
  conversationRow,
  enableTicketSurfaces,
  messageCount,
  mintVisitor,
  openWidget,
  openWidgetThread,
  seedBlockMessage,
  signSsoToken,
  threadStreamOpen,
  visitorSend,
  widgetFn,
  widgetSecret,
} from '../../support/widget-portal'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

/** A fresh anonymous visitor with one conversation, and a block seeded into it. */
async function visitorWithBlock(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  opening: string,
  blockText: string,
  block: Record<string, unknown> & { kind: string }
) {
  const visitor = await mintVisitor()
  const { conversation } = await visitorSend(request, visitor.token, opening)
  const blockId = await seedBlockMessage(conversation.id, blockText, block)
  const widget = await openWidget(page, { visitorToken: visitor.token })
  const live = threadStreamOpen(page, conversation.id)
  await openWidgetThread(widget, opening)
  await expect(widget.getByText(blockText)).toBeVisible({ timeout: 15_000 })
  await live
  return { visitor, conversation, widget, blockId }
}

test.describe('widget blocks', () => {
  test(
    'CUS-W-44 a reply button sends its label (server derived) and unlocks the composer',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      const { conversation, widget } = await visitorWithBlock(
        page,
        request,
        `${marker} hello`,
        `${marker} What is it about?`,
        {
          kind: 'buttons',
          options: [
            { key: 'billing', label: 'Billing' },
            { key: 'bug', label: 'A bug' },
          ],
          allowTyping: false,
        }
      )
      // Typing is locked until an option is chosen.
      await expect(widget.getByText('Choose an option above')).toBeVisible()
      await expect(composer(widget)).toHaveCount(0)

      await widget.getByRole('button', { name: 'A bug' }).click()
      await pollFor('the button reply', async () => {
        const [row] = await supportDb()`SELECT content, metadata FROM conversation_messages
          WHERE conversation_id = ${toUuid(conversation.id as `conversation_${string}`)}
            AND sender_type = 'visitor' AND metadata -> 'blockReply' IS NOT NULL`
        return row ?? null
      }).then((row) => {
        expect(row.content).toBe('A bug')
        expect(row.metadata.blockReply).toMatchObject({ kind: 'buttons', buttonKey: 'bug' })
      })
      await expect(composer(widget)).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText('Choose an option above')).toHaveCount(0)
    }
  )

  test(
    'CUS-W-44 a forged button key is not a block reply: the label comes from the server',
    { tag: '@core' },
    async ({ request, marker }) => {
      const visitor = await mintVisitor()
      const { conversation } = await visitorSend(request, visitor.token, `${marker} hi`)
      const blockId = await seedBlockMessage(conversation.id, `${marker} pick`, {
        kind: 'buttons',
        options: [{ key: 'ok', label: 'Okay' }],
        allowTyping: true,
      })
      const forged = await widgetFn(request, 'widgetSendConversationMessageFn', {
        bearer: visitor.token,
        data: {
          conversationId: conversation.id,
          content: 'Refund me now',
          blockReply: {
            kind: 'buttons',
            inReplyToMessageId: fromUuid('conversation_msg', blockId),
            buttonKey: 'not-an-option',
          },
        },
      })
      expect(forged.error).toBeUndefined()
      const [row] = await supportDb()`SELECT content, metadata FROM conversation_messages
        WHERE conversation_id = ${toUuid(conversation.id as `conversation_${string}`)}
          AND sender_type = 'visitor' ORDER BY created_at DESC LIMIT 1`
      expect(row.content).toBe('Refund me now')
      expect(row.metadata?.blockReply ?? null).toBeNull()
    }
  )

  test(
    'CUS-W-45 a collect block validates, stores the answer and then cannot be changed',
    { tag: '@nightly' },
    async ({ page, request, marker }) => {
      const { conversation, widget } = await visitorWithBlock(
        page,
        request,
        `${marker} hi`,
        `${marker} How many seats?`,
        { kind: 'collect', attributeKey: 'seats', fieldType: 'number', required: true }
      )
      await widget.getByRole('button', { name: 'Submit' }).click()
      await expect(widget.getByText('This field is required.')).toBeVisible()
      await widget.locator('input[type="number"]').fill('12')
      await widget.getByRole('button', { name: 'Submit' }).click()
      await expect(widget.getByText('Only our team can change this now.')).toBeVisible({
        timeout: 15_000,
      })
      const [row] = await supportDb()`SELECT content FROM conversation_messages
        WHERE conversation_id = ${toUuid(conversation.id as `conversation_${string}`)}
          AND sender_type = 'visitor' AND metadata -> 'blockReply' ->> 'kind' = 'collect'`
      expect(row.content).toBe('12')
    }
  )

  test(
    'CUS-W-46 an in-thread rating block records the rating and comment and thanks the visitor',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      const { conversation, widget } = await visitorWithBlock(
        page,
        request,
        `${marker} done`,
        `${marker} How did we do?`,
        { kind: 'csat', allowTypingInterrupt: true, commentPrompt: 'Anything to add?' }
      )
      await widget.getByRole('button', { name: '4 of 5' }).click()
      await widget.getByRole('textbox', { name: 'Add a comment (optional)' }).fill(`${marker} fast`)
      await widget.getByRole('button', { name: 'Send feedback' }).click()
      await expect(widget.getByText('Thanks for your feedback!')).toBeVisible({ timeout: 15_000 })
      await pollFor('the rating', async () => {
        const row = await conversationRow(conversation.id)
        return row.csat_rating === 4 ? row : null
      })
    }
  )

  test(
    'CUS-W-47 after a close the rating footer sets the rating once and adds the team note',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      const visitor = await mintVisitor()
      const opening = `${marker} all good`
      const { conversation } = await visitorSend(request, visitor.token, opening)
      await agentApi(request).status(conversation.id, 'closed')
      const widget = await openWidget(page, { visitorToken: visitor.token })
      await openWidgetThread(widget, /Conversation ended|all good/)
      await expect(widget.getByText('How was your conversation?')).toBeVisible({
        timeout: 15_000,
      })
      await widget.getByRole('button', { name: 'Rate 5 of 5' }).click()
      await expect(widget.getByText('Thanks! Anything we could improve?')).toBeVisible()
      await widget
        .getByRole('textbox', { name: 'Add a comment (optional)' })
        .fill(`${marker} great`)
      await widget.getByRole('button', { name: 'Send feedback' }).click()
      await expect(widget.getByText('Thanks for your feedback!')).toBeVisible({ timeout: 15_000 })

      const row = await pollFor('the rating and comment', async () => {
        const r = await conversationRow(conversation.id)
        return r.csat_rating === 5 && r.csat_comment ? r : null
      })
      expect(row.csat_comment).toContain(`${marker} great`)
      expect(row.status).toBe('closed')
      await pollFor('the internal team note', async () => {
        const [n] = await supportDb()`SELECT count(*)::int AS n FROM conversation_messages
          WHERE conversation_id = ${row.id} AND is_internal = true
            AND content ILIKE '%5%'`
        return (n.n as number) > 0 ? true : null
      })
      // Once per conversation: a second rating changes nothing.
      const again = await widgetFn(request, 'widgetSubmitCsatFn', {
        bearer: visitor.token,
        data: { conversationId: conversation.id, rating: 1 },
      })
      void again
      expect((await conversationRow(conversation.id)).csat_rating).toBe(5)
    }
  )

  test(
    "CUS-W-48 out-of-range ratings and someone else's conversation are refused; a second rating changes nothing",
    { tag: '@core' },
    async ({ request, marker }) => {
      const a = await mintVisitor()
      const b = await mintVisitor()
      const open = await visitorSend(request, a.token, `${marker} open`)
      const theirs = await visitorSend(request, b.token, `${marker} theirs`)
      await agentApi(request).status(theirs.conversation.id, 'closed')
      const rate = (token: string, conversationId: string, rating: number) =>
        widgetFn(request, 'widgetSubmitCsatFn', {
          bearer: token,
          data: { conversationId, rating },
        })

      expect((await rate(a.token, theirs.conversation.id, 5)).error).toMatchObject({
        code: 'CONVERSATION_NOT_FOUND',
      })
      for (const rating of [0, 6]) {
        const res = await rate(b.token, theirs.conversation.id, rating)
        expect(res.error?.message, `${rating}`).toMatch(/5|too_big|too_small|between/)
      }
      expect((await rate(b.token, theirs.conversation.id, 3)).error).toBeUndefined()
      // Ratings are once per conversation: a second one changes nothing.
      await rate(b.token, theirs.conversation.id, 1)
      expect((await conversationRow(theirs.conversation.id)).csat_rating).toBe(3)
      expect((await conversationRow(open.conversation.id)).csat_rating).toBeNull()
    }
  )

  test(
    'CUS-W-49 the ticket form block files a ticket and collapses to its confirmation',
    { tag: '@core' },
    async ({ page, request, customerEmail, marker }) => {
      await enableTicketSurfaces()
      const secret = await widgetSecret(request)
      const ssoToken = signSsoToken({ id: marker, email: customerEmail, name: 'Fay Form' }, secret)
      const widget = await openWidget(page, { ssoToken })
      const [principal] = await pollFor('the identified principal', async () => {
        const rows =
          await supportDb()`SELECT p.id FROM principal p JOIN "user" u ON u.id = p.user_id
          WHERE u.email = ${customerEmail}`
        return rows.length ? rows : null
      })
      // The visitor's own conversation, with the form block in it.
      await supportDb()`UPDATE principal SET display_name = 'Fay Form' WHERE id = ${principal.id}`
      const token = (
        await supportDb()`SELECT token FROM session s JOIN principal p ON p.user_id = s.user_id
          WHERE p.id = ${principal.id} ORDER BY s.created_at DESC LIMIT 1`
      )[0].token as string
      const { conversation } = await visitorSend(request, token, `${marker} need a ticket`)
      await seedBlockMessage(conversation.id, `${marker} Tell us more`, { kind: 'ticketForm' })
      await openWidgetThread(widget, `${marker} need a ticket`)
      const subject = widget.getByLabel(/Subject/)
      await expect(subject).toBeVisible({ timeout: 15_000 })
      const create = widget.getByRole('button', { name: 'Create ticket' })
      await expect(create).toBeDisabled()
      await subject.fill(`${marker} printer on fire`)
      await create.click()
      await expect(widget.getByText("Ticket filed. We'll track it from here.")).toBeVisible({
        timeout: 15_000,
      })
      const [ticket] = await supportDb()`SELECT type, requester_principal_id FROM tickets
        WHERE title = ${`${marker} printer on fire`}`
      expect(ticket).toMatchObject({ type: 'customer', requester_principal_id: principal.id })
    }
  )
  test(
    'CUS-W-33 the expected reply time block shows as a quiet caption with the online or away wording',
    { tag: '@nightly' },
    async ({ page, request, marker }) => {
      const visitor = await mintVisitor()
      const opening = `${marker} when will you reply`
      const { conversation } = await visitorSend(request, visitor.token, opening)
      await seedBlockMessage(conversation.id, 'We typically reply in under an hour.', {
        kind: 'replyTime',
        status: 'online',
      })
      await seedBlockMessage(conversation.id, 'We are away.', { kind: 'replyTime', status: 'away' })
      const widget = await openWidget(page, { visitorToken: visitor.token })
      await openWidgetThread(widget, opening)
      await expect(
        widget.getByText("We're online, typically replies in under an hour.")
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        widget.getByText(
          "We're away right now. We'll get back to you as soon as we're back online."
        )
      ).toBeVisible()
      // A caption, not a chat bubble carrying the stored transcript text.
      await expect(widget.getByText('We typically reply in under an hour.')).toHaveCount(0)
    }
  )
})

test.describe('widget attachments and email', () => {
  test(
    'CUS-W-41 a visitor attaches a file; the upload is stored and the agent sees it',
    { tag: '@core' },
    async ({ page, request, asPerson, marker }) => {
      const visitor = await mintVisitor()
      const opening = `${marker} screenshot`
      const { conversation } = await visitorSend(request, visitor.token, opening)
      const widget = await openWidget(page, { visitorToken: visitor.token })
      await openWidgetThread(widget, opening)
      await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })

      const fileName = `${marker}.png`
      const uploaded = page.waitForResponse((r) => r.url().includes('/api/widget/files'))
      await widget
        .locator('input[type="file"]')
        .first()
        .setInputFiles({ name: fileName, mimeType: 'image/png', buffer: PNG_1X1 })
      expect((await uploaded).status()).toBe(201)
      const send = widget.getByRole('button', { name: 'Send', exact: true })
      await expect(send).toBeEnabled({ timeout: 15_000 })
      await send.click()
      await expect(widget.locator(`img[src*="${fileName}"]`).first()).toBeAttached({
        timeout: 15_000,
      })
      const [row] = await pollFor('the attachment', async () => {
        const rows = await supportDb()`SELECT attachments FROM conversation_messages
          WHERE conversation_id = ${toUuid(conversation.id as `conversation_${string}`)}
            AND attachments IS NOT NULL`
        return rows.length ? rows : null
      })
      expect((row.attachments as Array<{ name: string }>)[0].name).toBe(fileName)
      // The team sees the same attachment in the inbox.
      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conversation.id}`)
      await expect(admin.getByText(opening).first()).toBeVisible({ timeout: 15_000 })
      await expect(admin.locator(`img[src*="${fileName}"]`).first()).toBeAttached({
        timeout: 15_000,
      })
    }
  )

  test(
    'CUS-W-42 empty, blocked-type and unsessioned uploads are refused with their codes',
    { tag: '@nightly' },
    async ({ request }) => {
      const visitor = await mintVisitor()
      const auth = { authorization: `Bearer ${visitor.token}` }
      const none = await request.post('/api/widget/files?name=a.png', { data: PNG_1X1 })
      expect(none.status()).toBe(401)
      const empty = await request.post('/api/widget/files?name=a.png', {
        headers: { ...auth, 'content-type': 'image/png' },
        data: Buffer.alloc(0),
      })
      expect(empty.status()).toBe(400)
      const blocked = await request.post('/api/widget/files?name=run.exe', {
        headers: { ...auth, 'content-type': 'application/octet-stream' },
        data: Buffer.from('MZ fake executable'),
      })
      expect(blocked.status()).toBe(415)
    }
  )

  test(
    'CUS-W-43 the legacy media upload needs a session and a form body',
    { tag: '@nightly' },
    async ({ request }) => {
      const visitor = await mintVisitor()
      const none = await request.post('/api/widget/upload', { data: 'x' })
      expect(none.status()).toBe(401)
      const bad = await request.post('/api/widget/upload', {
        headers: { authorization: `Bearer ${visitor.token}`, 'content-type': 'text/plain' },
        data: 'not a form',
      })
      expect(bad.status()).toBe(400)
    }
  )

  test(
    'CUS-W-50 the widget never captures an email inline, and the send ignores a visitorEmail field',
    { tag: '@nightly' },
    async ({ page, request, marker }) => {
      const visitor = await mintVisitor()
      const opening = `${marker} no email`
      const sent = await widgetFn<{ conversation: { id: string } }>(
        request,
        'widgetSendConversationMessageFn',
        {
          bearer: visitor.token,
          data: { content: opening, visitorEmail: `${marker}@customers.example` },
        }
      )
      expect(sent.error).toBeUndefined()
      const row = await conversationRow(sent.value!.conversation.id)
      expect(row.visitor_email).toBeNull()
      const widget = await openWidget(page, { visitorToken: visitor.token })
      await openWidgetThread(widget, opening)
      await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await expect(widget.locator('input[type="email"]')).toHaveCount(0)
      expect(await messageCount(sent.value!.conversation.id)).toBe(1)
    }
  )
})
