/**
 * The widget messenger from the customer's side (area CUS-W): a visitor
 * writes, a teammate answers, the visitor sees it live, and what the team
 * keeps to itself never reaches the widget.
 */
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { fakeAi } from '../../support/fake-ai-client'
import {
  adminRequest,
  adminWrite,
  agentApi,
  composer,
  conversationCount,
  conversationRow,
  conversationWithMessage,
  createTicket,
  deleteMessage,
  editMessage,
  enableTicketSurfaces,
  inboxWrite,
  messageCount,
  mintVisitor,
  moveTicket,
  openWidget,
  openWidgetThread,
  signSsoToken,
  streamStatus,
  threadStreamOpen,
  visitorSend,
  visitorType,
  widgetFn,
  widgetSecret,
  widgetTab,
} from '../../support/widget-portal'

test.describe('widget chat: the core loop', () => {
  test(
    'CUS-W-12 a first message starts an open, unassigned messenger conversation the inbox shows',
    { tag: '@smoke' },
    async ({ page, asPerson, marker }) => {
      // A fresh browser is a fresh anonymous visitor: the first send mints the session.
      const widget = await openWidget(page)
      await widgetTab(widget, 'Messages').click()
      await widget.getByRole('button', { name: /Ask a question/ }).click()
      await expect(composer(widget)).toBeVisible({ timeout: 15_000 })
      const text = `${marker} first message`
      await visitorType(widget, text)
      await expect(widget.getByText(text)).toBeVisible({ timeout: 15_000 })

      const row = await conversationWithMessage(text)
      expect(row.channel).toBe('messenger')
      expect(row.status).toBe('open')
      expect(row.assigned_agent_principal_id).toBeNull()
      expect(row.subject).toContain(marker)
      expect(row.waiting_since).not.toBeNull()
      const [visitor] = await supportDb()`
        SELECT p.type, m.sender_type FROM principal p
        JOIN conversation_messages m ON m.principal_id = p.id
        WHERE p.id = ${row.visitor_principal_id} AND m.conversation_id = ${row.id}`
      expect(visitor).toMatchObject({ type: 'anonymous', sender_type: 'visitor' })

      const admin = await asPerson('admin')
      await admin.goto('/admin/inbox')
      await expect(admin.getByText(text).first()).toBeVisible({ timeout: 15_000 })
    }
  )

  test(
    'CUS-W-23 an agent reply from the inbox reaches the open widget live; a note never does',
    { tag: '@smoke' },
    async ({ page, asPerson, request, marker }) => {
      const visitor = await mintVisitor()
      const opening = `${marker} needs help`
      const { conversation } = await visitorSend(request, visitor.token, opening)

      const widget = await openWidget(page, { visitorToken: visitor.token })
      const live = threadStreamOpen(page, conversation.id)
      await openWidgetThread(widget, opening)
      await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await live

      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conversation.id}`)
      await expect(admin.getByText(opening).first()).toBeVisible({ timeout: 15_000 })

      // The note first, then the reply: once the reply is in the widget, the
      // note has had every chance to arrive.
      const note = `${marker} internal note`
      await inboxWrite(admin, 'Note', note)
      const reply = `${marker} agent reply`
      await inboxWrite(admin, 'Reply', reply)

      await expect(widget.getByText(reply)).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText('Ada Admin').first()).toBeVisible()
      await expect(widget.getByText(note)).toHaveCount(0)
    }
  )

  test(
    'CUS-W-28 assignment notices show to the team but never in the widget, live or after reload',
    { tag: '@smoke' },
    async ({ page, asPerson, request, people, marker }) => {
      const visitor = await mintVisitor()
      const opening = `${marker} who is on this`
      const { conversation } = await visitorSend(request, visitor.token, opening)
      const conversationUuid = toUuid(conversation.id as `conversation_${string}`)
      // An older row written before notices became internal: public, matched by its prefix.
      const legacy = `Conversation assigned to Legacy ${marker}`
      await supportDb()`
        INSERT INTO conversation_messages (id, conversation_id, sender_type, content, is_internal, created_at)
        VALUES (gen_random_uuid(), ${conversationUuid}, 'system', ${legacy}, false, NOW())`

      const widget = await openWidget(page, { visitorToken: visitor.token })
      const live = threadStreamOpen(page, conversation.id)
      await openWidgetThread(widget, opening)
      await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await live

      const api = agentApi(request)
      await api.assign(conversation.id, people.people.agentB.principalId)
      const sentinel = `${marker} after assignment`
      await api.reply(conversation.id, sentinel)

      const [notice] = await supportDb()`
        SELECT is_internal FROM conversation_messages
        WHERE conversation_id = ${conversationUuid} AND sender_type = 'system'
          AND content LIKE 'Conversation assigned to Ben Agent%'`
      expect(notice?.is_internal).toBe(true)

      // Live: the reply sent after the assignment arrives, the notice does not.
      await expect(widget.getByText(sentinel)).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText(/Conversation assigned to/)).toHaveCount(0)

      // After a reload too, and the legacy public notice stays hidden.
      await page.reload()
      const again = page.frameLocator('iframe.quackback-widget-iframe')
      await openWidgetThread(again, sentinel)
      await expect(again.getByText(sentinel)).toBeVisible({ timeout: 15_000 })
      await expect(again.getByText(/assigned to/)).toHaveCount(0)

      // The team still sees who has it.
      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conversation.id}`)
      await expect(admin.getByText(/assigned to Ben Agent/).first()).toBeVisible({
        timeout: 15_000,
      })
      expect((await conversationRow(conversation.id)).assigned_agent_principal_id).toBe(
        toUuid(people.people.agentB.principalId as `principal_${string}`)
      )
    }
  )
})

test.describe('widget chat: what the endpoints refuse', () => {
  test(
    'CUS-W-14 empty, over-long and too-many-attachment sends are refused and write nothing',
    { tag: '@core' },
    async ({ request }) => {
      const visitor = await mintVisitor()
      const send = (data: Record<string, unknown>) =>
        widgetFn(request, 'widgetSendConversationMessageFn', { bearer: visitor.token, data })

      const empty = await send({ content: '   ' })
      expect(empty.error).toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 })

      const long = await send({ content: 'x'.repeat(4001) })
      expect(long.error?.message).toMatch(/4000|too_big|too long|at most/i)

      const attachment = {
        url: '/api/storage/x.png',
        name: 'x.png',
        contentType: 'image/png',
        size: 1,
      }
      const many = await send({ content: 'hi', attachments: Array(11).fill(attachment) })
      expect(many.error?.message).toMatch(/10|too_big|at most/i)

      expect(await conversationCount(visitor.principalUuid)).toBe(0)
    }
  )

  test(
    "CUS-W-15 a visitor gets not-found for someone else's conversation id, and nothing is written",
    { tag: '@core' },
    async ({ request, marker }) => {
      const a = await mintVisitor()
      const b = await mintVisitor()
      const { conversation } = await visitorSend(request, b.token, `${marker} B's thread`)
      const unknown = generateId('conversation')

      for (const id of [conversation.id, unknown]) {
        const calls = [
          ['widgetSendConversationMessageFn', { conversationId: id, content: `${marker} from A` }],
          ['widgetListConversationMessagesFn', { conversationId: id }],
          ['widgetMarkConversationReadFn', { conversationId: id }],
          ['widgetSendConversationTypingFn', { conversationId: id }],
          ['widgetSubmitCsatFn', { conversationId: id, rating: 5 }],
        ] as const
        for (const [name, data] of calls) {
          const res = await widgetFn(request, name, { bearer: a.token, data })
          expect(res.error, `${name} on ${id === unknown ? 'unknown' : "B's"} id`).toMatchObject({
            code: 'CONVERSATION_NOT_FOUND',
          })
        }
      }
      expect(await messageCount(conversation.id)).toBe(1)
      expect(await conversationCount(a.principalUuid)).toBe(0)
      expect((await conversationRow(conversation.id)).csat_rating).toBeNull()
    }
  )

  test(
    'CUS-W-16 without a session the writes answer 401 and the reads answer empty',
    { tag: '@core' },
    async ({ request }) => {
      const id = generateId('conversation')
      const writes = [
        ['widgetSendConversationMessageFn', { content: 'hello' }],
        ['widgetListConversationMessagesFn', { conversationId: id }],
        ['widgetMarkConversationReadFn', { conversationId: id }],
        ['widgetSendConversationTypingFn', { conversationId: id }],
        ['widgetSubmitCsatFn', { conversationId: id, rating: 5 }],
        ['widgetMintConversationStreamTokenFn', undefined],
      ] as const
      for (const [name, data] of writes) {
        const res = await widgetFn(request, name, { data })
        expect(res.error, name).toMatchObject({
          statusCode: 401,
          message: 'Authentication required',
        })
      }

      const mine = await widgetFn<{ conversation: unknown; messages: unknown[] }>(
        request,
        'widgetGetMyConversationFn',
        { data: {} }
      )
      expect(mine.value).toMatchObject({ conversation: null, messages: [] })
      const list = await widgetFn<{ conversations: unknown[] }>(
        request,
        'widgetGetMyConversationsFn'
      )
      expect(list.value?.conversations).toEqual([])
      const unread = await widgetFn(request, 'widgetGetMessengerUnreadFn')
      expect(unread.value).toEqual({ conversations: 0, total: 0 })
    }
  )

  test(
    'CUS-W-18 a blocked visitor cannot send, and no message is written',
    { tag: '@core' },
    async ({ request, marker }) => {
      const visitor = await mintVisitor()
      const { conversation } = await visitorSend(request, visitor.token, `${marker} before block`)
      await supportDb()`UPDATE principal SET blocked_at = NOW() WHERE id = ${visitor.principalUuid}`

      const followUp = await widgetFn(request, 'widgetSendConversationMessageFn', {
        bearer: visitor.token,
        data: { conversationId: conversation.id, content: `${marker} after block` },
      })
      expect(followUp.error).toMatchObject({
        code: 'BLOCKED',
        statusCode: 403,
        message: 'You are not able to send messages here.',
      })
      const fresh = await widgetFn(request, 'widgetSendConversationMessageFn', {
        bearer: visitor.token,
        data: { content: `${marker} new thread after block` },
      })
      expect(fresh.error).toMatchObject({ code: 'BLOCKED' })
      expect(await messageCount(conversation.id)).toBe(1)
      expect(await conversationCount(visitor.principalUuid)).toBe(1)
    }
  )

  test(
    'CUS-W-24 the stream needs a token, hides other visitors, and refuses team scopes',
    { tag: '@core' },
    async ({ request, marker }) => {
      const a = await mintVisitor()
      const b = await mintVisitor()
      const mine = await visitorSend(request, a.token, `${marker} A`)
      const theirs = await visitorSend(request, b.token, `${marker} B`)
      const minted = await widgetFn<{ token: string }>(
        request,
        'widgetMintConversationStreamTokenFn',
        { bearer: a.token }
      )
      const token = minted.value!.token
      expect(token).toBeTruthy()
      const own = mine.conversation.id

      const ok = await streamStatus(`conversationId=${own}&token=${token}`)
      expect(ok.status).toBe(200)
      expect(ok.contentType).toContain('text/event-stream')

      expect((await streamStatus(`conversationId=${own}`)).status).toBe(401)
      expect((await streamStatus(`conversationId=${own}&token=${token}x`)).status).toBe(401)
      expect(
        (await streamStatus(`conversationId=${theirs.conversation.id}&token=${token}`)).status
      ).toBe(404)
      expect((await streamStatus(`token=${token}`)).status).toBe(400)
      expect((await streamStatus(`scope=inbox&token=${token}`)).status).toBe(403)
      const ticket = generateId('ticket')
      expect((await streamStatus(`ticketId=${ticket}&token=${token}`)).status).toBe(403)
    }
  )
})

/** A fresh anonymous visitor with one conversation, its thread open in the widget. */
async function visitorWithOpenThread(
  page: Page,
  request: APIRequestContext,
  opening: string,
  name?: string
) {
  const visitor = await mintVisitor({ name })
  const { conversation } = await visitorSend(request, visitor.token, opening)
  const widget = await openWidget(page, { visitorToken: visitor.token })
  const live = threadStreamOpen(page, conversation.id)
  await openWidgetThread(widget, opening)
  await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })
  await live
  return { visitor, conversation, widget }
}

test.describe('widget chat: the live thread', () => {
  test.beforeAll(async () => {
    await enableTicketSurfaces()
  })

  test(
    'CUS-W-13 a follow-up updates the same conversation, wakes it and shows live in the inbox',
    { tag: '@core' },
    async ({ page, request, asPerson, marker }) => {
      const opening = `${marker} first`
      const { visitor, conversation, widget } = await visitorWithOpenThread(page, request, opening)
      const uuid = toUuid(conversation.id as `conversation_${string}`)
      await supportDb()`UPDATE conversations SET status = 'snoozed',
        snoozed_until = NOW() + interval '1 day' WHERE id = ${uuid}`

      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conversation.id}`)
      await expect(admin.getByText(opening).first()).toBeVisible({ timeout: 15_000 })

      const followUp = `${marker} follow-up`
      await visitorType(widget, followUp)
      await expect(widget.getByText(followUp)).toBeVisible({ timeout: 15_000 })
      // Live in the teammate's open thread, no reload.
      await expect(admin.getByText(followUp).first()).toBeVisible({ timeout: 15_000 })

      const row = await conversationRow(conversation.id)
      expect(row).toMatchObject({
        status: 'open',
        snoozed_until: null,
        last_message_preview: followUp,
        channel: 'messenger',
      })
      expect(await conversationCount(visitor.principalUuid)).toBe(1)
      expect(await messageCount(conversation.id)).toBe(2)
    }
  )

  test(
    'CUS-W-20 a reply to a closed conversation reopens it, with no reopened notice',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      const opening = `${marker} question`
      const { conversation, widget } = await visitorWithOpenThread(page, request, opening)
      await agentApi(request).status(conversation.id, 'closed')

      const hint = widget.getByText('This conversation was closed. Reply to reopen it.')
      await expect(hint).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText('How was your conversation?')).toBeVisible()

      const reply = `${marker} one more thing`
      await visitorType(widget, reply)
      await expect(widget.getByText(reply)).toBeVisible({ timeout: 15_000 })
      await expect(hint).toHaveCount(0, { timeout: 15_000 })
      await expect(widget.getByText('How was your conversation?')).toHaveCount(0)

      const row = await conversationRow(conversation.id)
      expect(row.status).toBe('open')
      expect(row.resolved_at).toBeNull()
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM conversation_messages
        WHERE conversation_id = ${row.id}
          AND metadata -> 'systemEvent' ->> 'kind' = 'chat_reopened'`
      expect(n).toBe(0)
    }
  )

  test(
    'CUS-W-29 an agent close shows "Conversation ended", the closed hint and the rating footer, once',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      const opening = `${marker} thanks`
      const { conversation, widget } = await visitorWithOpenThread(page, request, opening)
      const api = agentApi(request)
      await api.status(conversation.id, 'closed')

      await expect(widget.getByText('Conversation ended')).toBeVisible({ timeout: 15_000 })
      await expect(
        widget.getByText('This conversation was closed. Reply to reopen it.')
      ).toBeVisible()
      await expect(widget.getByText('How was your conversation?')).toBeVisible()

      // Closing an already-closed conversation writes no second notice.
      await api.status(conversation.id, 'closed')
      const uuid = toUuid(conversation.id as `conversation_${string}`)
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM conversation_messages
        WHERE conversation_id = ${uuid} AND sender_type = 'system' AND is_internal = false
          AND metadata -> 'systemEvent' ->> 'kind' = 'chat_ended'`
      expect(n).toBe(1)
      await page.reload()
      const again = page.frameLocator('iframe.quackback-widget-iframe')
      await openWidgetThread(again, /Conversation ended|thanks/)
      await expect(again.getByText('Conversation ended')).toHaveCount(1, { timeout: 15_000 })
    }
  )

  test(
    'CUS-W-27 the widget shows "Seen" once a teammate opens the thread, and hides it after a newer message',
    { tag: '@core' },
    async ({ page, request, asPerson, marker }) => {
      const opening = `${marker} anyone there`
      const { conversation, widget } = await visitorWithOpenThread(page, request, opening)
      await expect(widget.getByText('Seen', { exact: true })).toHaveCount(0)

      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conversation.id}`)
      await expect(admin.getByText(opening).first()).toBeVisible({ timeout: 15_000 })

      await expect(widget.getByText('Seen', { exact: true })).toBeVisible({ timeout: 15_000 })
      expect((await conversationRow(conversation.id)).agent_last_read_at).not.toBeNull()

      await admin.close()
      const newer = `${marker} hello?`
      await visitorType(widget, newer)
      await expect(widget.getByText(newer)).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText('Seen', { exact: true })).toHaveCount(0)
    }
  )

  test(
    'CUS-W-26 typing shows both ways, with no teammate identity, and clears when the reply lands',
    { tag: '@core' },
    async ({ page, request, asPerson, marker }) => {
      const opening = `${marker} typing test`
      const visitorName = `Tess ${marker.slice(-6)}`
      const { conversation, widget } = await visitorWithOpenThread(
        page,
        request,
        opening,
        visitorName
      )
      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conversation.id}`)
      await expect(admin.getByText(opening).first()).toBeVisible({ timeout: 15_000 })

      // Visitor types: the inbox names them. (Keep typing until the teammate's
      // stream, which connects after the page renders, picks it up.)
      await composer(widget).click()
      await expect(async () => {
        await composer(widget).pressSequentially('ab', { delay: 30 })
        await expect(admin.getByText(`${visitorName} is typing…`)).toBeVisible({
          timeout: 1_500,
        })
      }).toPass({ timeout: 20_000 })

      // Agent types: the widget shows dots and nothing about who.
      const dots = widget.locator('.animate-bounce')
      await composer(admin).click()
      await expect(async () => {
        await composer(admin).pressSequentially('ok', { delay: 30 })
        await expect(dots.first()).toBeVisible({ timeout: 1_500 })
      }).toPass({ timeout: 20_000 })
      await expect(widget.getByText(/Ada Admin|is typing/)).toHaveCount(0)

      const reply = `${marker} found it`
      await composer(admin).fill(reply)
      await admin.getByRole('button', { name: 'Send reply' }).click()
      await expect(widget.getByText(reply)).toBeVisible({ timeout: 15_000 })
      await expect(dots).toHaveCount(0)
    }
  )

  test(
    'CUS-W-34 an empty Messages list offers to ask; the new thread greets, fronted by the assistant',
    { tag: '@core' },
    async ({ page, request }) => {
      const visitor = await mintVisitor()
      // No team name is configured: the thread's team name is the workspace name.
      const [{ name }] = await supportDb()`SELECT name FROM settings LIMIT 1`
      const mine = await widgetFn<{
        teamName: string
        welcomeMessage: string | null
        assistant: { name: string } | null
      }>(request, 'widgetGetMyConversationFn', { bearer: visitor.token, data: {} })
      expect(mine.value?.teamName).toBe(name)

      const widget = await openWidget(page, { visitorToken: visitor.token })
      await widgetTab(widget, 'Messages').click()
      await expect(widget.getByText('No conversations yet')).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText("Questions or feedback? We're here to help.")).toBeVisible()
      await widget.getByRole('button', { name: /Ask a question/ }).click()
      await expect(widget.getByText('Hi! 👋 How can we help you today?')).toBeVisible({
        timeout: 15_000,
      })
      // The assistant identity is on by default: it fronts the thread header
      // and signs the greeting.
      const assistant = mine.value?.assistant?.name
      expect(assistant).toBeTruthy()
      await expect(widget.getByText(assistant!, { exact: true }).first()).toBeVisible()
      await expect(widget.getByText('The team can also help')).toBeVisible()
    }
  )

  test(
    'CUS-W-35 the Messages list and tab badge count agent replies only, and clear once read',
    { tag: '@core' },
    async ({ page, request, people, marker }) => {
      const visitor = await mintVisitor()
      const quiet = await visitorSend(request, visitor.token, `${marker} quiet thread`)
      const busy = await visitorSend(request, visitor.token, `${marker} busy thread`)
      const api = agentApi(request)
      await api.note(busy.conversation.id, `${marker} a note`)
      await api.assign(busy.conversation.id, people.people.agentB.principalId)
      await api.reply(busy.conversation.id, `${marker} reply one`)
      await api.reply(busy.conversation.id, `${marker} reply two`)

      const widget = await openWidget(page, { visitorToken: visitor.token })
      await expect(widget.getByRole('button', { name: '2 unread Messages' })).toBeVisible({
        timeout: 15_000,
      })
      await widgetTab(widget, 'Messages').click()
      const busyRow = widget.getByRole('button', { name: new RegExp(`${marker} reply two`) })
      await expect(busyRow).toContainText('2 unread')
      const quietRow = widget.getByRole('button', { name: new RegExp(`${marker} quiet thread`) })
      await expect(quietRow).not.toContainText('unread')
      expect(quiet.conversation.id).not.toBe(busy.conversation.id)

      await busyRow.click()
      await expect(widget.getByText(`${marker} reply two`)).toBeVisible({ timeout: 15_000 })
      await widget.getByRole('button', { name: 'Go back' }).click()
      await expect(widget.getByRole('button', { name: /^Messages$/ })).toBeVisible({
        timeout: 15_000,
      })
      await expect(widget.getByRole('button', { name: /unread Messages/ })).toHaveCount(0)
      await expect(busyRow).not.toContainText('unread')
    }
  )

  test(
    'CUS-W-38 an agent edit shows "(edited)" and a delete removes the bubble, live; a note edit sends nothing',
    { tag: '@core' },
    async ({ page, request, playwright, marker }) => {
      const opening = `${marker} edit me`
      const { conversation, widget } = await visitorWithOpenThread(page, request, opening)
      const admin = await adminRequest(playwright)
      const first = await adminWrite(admin, 'reply', conversation.id, `${marker} first answer`)
      const second = await adminWrite(admin, 'reply', conversation.id, `${marker} wrong answer`)
      const note = await adminWrite(admin, 'note', conversation.id, `${marker} private note`)
      await expect(widget.getByText(`${marker} wrong answer`)).toBeVisible({ timeout: 15_000 })

      await editMessage(admin, note.id as string, `${marker} private note, edited`)
      await editMessage(admin, first.id as string, `${marker} better answer`)
      await expect(widget.getByText(`${marker} better answer`)).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText('(edited)')).toHaveCount(1)
      await deleteMessage(admin, second.id as string)
      await expect(widget.getByText(`${marker} wrong answer`)).toHaveCount(0, { timeout: 15_000 })
      await expect(widget.getByText(/private note/)).toHaveCount(0)
      await admin.dispose()
    }
  )

  test(
    'CUS-W-39 a ticket made from the conversation and its stage moves show in the widget thread',
    { tag: '@core' },
    async ({ page, request, playwright, marker }) => {
      const opening = `${marker} broken export`
      const { visitor, conversation, widget } = await visitorWithOpenThread(page, request, opening)
      const admin = await adminRequest(playwright)
      const ticket = await createTicket(admin, {
        title: `${marker} export ticket`,
        requesterPrincipalId: visitor.principalId,
        conversationId: conversation.id,
      })
      await expect(
        widget.getByText(`Ticket ${ticket.reference} created from this conversation`)
      ).toBeVisible({ timeout: 15_000 })

      await moveTicket(admin, ticket.id, 'Investigating')
      await expect(widget.getByText('Status updated to In progress')).toBeVisible({
        timeout: 15_000,
      })
      // The header card appears and follows the stage, in place.
      await expect(widget.getByText(`${marker} export ticket`).first()).toBeVisible({
        timeout: 15_000,
      })
      await expect(widget.getByText('In progress').first()).toBeVisible()
      await admin.dispose()
    }
  )

  test(
    'CUS-W-30 an AI spam verdict files the conversation closed, and the visitor sees no spam notice',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      const spamMarker = `${marker}-spam`
      await fakeAi.script({ marker: spamMarker, json: { spam: true } })
      const visitor = await mintVisitor()
      const opening = `Cheap pills ${spamMarker}`
      const { conversation } = await visitorSend(request, visitor.token, opening)

      const row = await pollFor('the spam filing', async () => {
        const r = await conversationRow(conversation.id)
        return r.end_reason === 'spam' ? r : null
      })
      expect(row.status).toBe('closed')
      expect(row.spam_reason).toBeTruthy()
      // Whatever the filing records stays with the team.
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM conversation_messages
        WHERE conversation_id = ${row.id} AND sender_type = 'system' AND is_internal = false`
      expect(n).toBe(0)

      const widget = await openWidget(page, { visitorToken: visitor.token })
      await openWidgetThread(widget, opening)
      await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await expect(
        widget.getByText('This conversation was closed. Reply to reopen it.')
      ).toBeVisible()
      await expect(widget.getByText(/spam/i)).toHaveCount(1) // only the visitor's own words
      await expect(widget.getByText(/auto-filed/i)).toHaveCount(0)
    }
  )
})

test.describe('widget chat: identified visitors', () => {
  test.beforeAll(async () => {
    await enableTicketSurfaces()
  })

  test(
    'CUS-W-36 the Tickets tab stays hidden until the visitor has a ticket, then sits after Messages',
    { tag: '@core' },
    async ({ page, request, playwright, customerEmail, marker }) => {
      const secret = await widgetSecret(request)
      const ssoToken = signSsoToken(
        { id: marker, email: customerEmail, name: 'Tia Tickets' },
        secret
      )
      const widget = await openWidget(page, { ssoToken })
      await expect(widgetTab(widget, 'Messages')).toBeVisible({ timeout: 15_000 })
      await expect(widgetTab(widget, 'Tickets')).toHaveCount(0)

      const [principal] = await supportDb()`SELECT p.id FROM principal p
        JOIN "user" u ON u.id = p.user_id WHERE u.email = ${customerEmail}`
      const admin = await adminRequest(playwright)
      await createTicket(admin, {
        title: `${marker} first ticket`,
        requesterPrincipalId: fromUuid('principal', principal.id as string),
      })
      await admin.dispose()

      await page.reload()
      const again = page.frameLocator('iframe.quackback-widget-iframe')
      await expect(widgetTab(again, 'Tickets')).toBeVisible({ timeout: 20_000 })
      const labels = await again
        .getByRole('button', {
          name: /^(?:\d+ unread )?(Home|Messages|Tickets|Help|News|Feedback)$/,
        })
        .allTextContents()
      const order = labels.map((l) => l.replace(/^\d+/, '').trim())
      expect(order.indexOf('Tickets')).toBe(order.indexOf('Messages') + 1)
      await widgetTab(again, 'Tickets').click()
      await expect(again.getByText(`${marker} first ticket`)).toBeVisible({ timeout: 15_000 })
    }
  )
})

test.describe('widget chat: limits and history', () => {
  test(
    'CUS-W-19 the 21st visitor send in the window is rate limited; a teammate burst is not',
    { tag: '@nightly' },
    async ({ request, playwright, marker }) => {
      // The send budget is keyed on the sender's principal, so this burst
      // throttles nobody else.
      const visitor = await mintVisitor()
      const { conversation } = await visitorSend(request, visitor.token, `${marker} 1`)
      for (let i = 2; i <= 20; i++) {
        await visitorSend(request, visitor.token, `${marker} ${i}`, conversation.id)
      }
      const over = await widgetFn(request, 'widgetSendConversationMessageFn', {
        bearer: visitor.token,
        data: { conversationId: conversation.id, content: `${marker} 21` },
      })
      expect(over.error?.message).toBe(
        'You are sending messages too quickly. Please wait a moment.'
      )
      expect(await messageCount(conversation.id)).toBe(20)

      const admin = await adminRequest(playwright)
      for (let i = 1; i <= 21; i++) {
        await adminWrite(admin, 'reply', conversation.id, `${marker} agent ${i}`)
      }
      expect(await messageCount(conversation.id)).toBe(41)
      await admin.dispose()
    }
  )

  test(
    'CUS-W-19 the rate-limit refusal carries RATE_LIMITED and retryAfter to the client',
    { tag: ['@nightly', '@quarantine'] },
    async ({ request, marker }) => {
      // Quarantined: ConversationRateLimitError is a plain Error, not a typed
      // DomainException, so only its message crosses the wire (see QUARANTINE.md).
      const visitor = await mintVisitor()
      const { conversation } = await visitorSend(request, visitor.token, `${marker} 1`)
      for (let i = 2; i <= 20; i++) {
        await visitorSend(request, visitor.token, `${marker} ${i}`, conversation.id)
      }
      const over = await widgetFn(request, 'widgetSendConversationMessageFn', {
        bearer: visitor.token,
        data: { conversationId: conversation.id, content: `${marker} 21` },
      })
      expect(over.error).toMatchObject({ code: 'RATE_LIMITED' })
      expect(Number(over.error?.retryAfter)).toBeGreaterThan(0)
    }
  )

  test(
    'CUS-W-22 a closed thread reads as read-only, and a send without its id starts a new conversation',
    { tag: '@nightly' },
    async ({ request, marker }) => {
      const visitor = await mintVisitor()
      const old = await visitorSend(request, visitor.token, `${marker} old question`)
      await agentApi(request).status(old.conversation.id, 'closed')

      const past = await widgetFn<{ isReadOnly: boolean; conversation: { id: string } | null }>(
        request,
        'widgetGetMyConversationFn',
        { bearer: visitor.token, data: { conversationId: old.conversation.id } }
      )
      expect(past.value?.isReadOnly).toBe(true)
      expect(past.value?.conversation?.id).toBe(old.conversation.id)

      const fresh = await visitorSend(request, visitor.token, `${marker} new question`)
      expect(fresh.conversation.id).not.toBe(old.conversation.id)
      expect(fresh.conversation.status).toBe('open')
      expect((await conversationRow(old.conversation.id)).status).toBe('closed')
      expect(await conversationCount(visitor.principalUuid)).toBe(2)
    }
  )

  test(
    'CUS-W-37 scrolling up loads older public messages, never notes, and offers "Jump to latest"',
    { tag: '@nightly' },
    async ({ page, request, marker }) => {
      const visitor = await mintVisitor()
      const { conversation } = await visitorSend(request, visitor.token, `${marker} latest`)
      const uuid = toUuid(conversation.id as `conversation_${string}`)
      // 45 older public messages and a note among them, all before the opener.
      await supportDb()`
        INSERT INTO conversation_messages (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
        SELECT gen_random_uuid(), ${uuid}, ${visitor.principalUuid}, 'visitor',
               ${marker} || ' old ' || lpad(g::text, 2, '0'), false,
               NOW() - make_interval(mins => 100 - g)
        FROM generate_series(1, 45) g`
      await supportDb()`
        INSERT INTO conversation_messages (id, conversation_id, sender_type, content, is_internal, created_at)
        VALUES (gen_random_uuid(), ${uuid}, 'agent', ${`${marker} hidden note`}, true,
                NOW() - make_interval(mins => 90))`

      const widget = await openWidget(page, { visitorToken: visitor.token })
      await openWidgetThread(widget, `${marker} latest`)
      await expect(widget.getByText(`${marker} latest`)).toBeVisible({ timeout: 15_000 })
      const oldest = widget.getByText(`${marker} old 01`, { exact: true })
      await expect(oldest).toHaveCount(0)

      await expect(async () => {
        await widget
          .getByText(/ old \d\d$/)
          .first()
          .scrollIntoViewIfNeeded()
        await widget.locator('body').hover()
        await page.mouse.wheel(0, -4000)
        const loadOlder = widget.getByRole('button', { name: 'Load earlier messages' })
        if (await loadOlder.isVisible()) await loadOlder.click()
        await expect(oldest).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 20_000 })
      await expect(widget.getByRole('button', { name: 'Jump to latest' })).toBeVisible()
      await expect(widget.getByText(`${marker} hidden note`)).toHaveCount(0)
    }
  )
})
