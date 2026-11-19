/**
 * Live delivery between teammates and customers (RT-*): what each side's
 * stream carries, what the widget and inbox show without a reload, and what
 * never reaches the customer.
 *
 * Streams are read raw (support/streams.ts) and warmed up first (a typing
 * frame proves the subscription), and an absence is always checked against a
 * later frame the same stream must carry.
 */
import { createHmac } from 'node:crypto'
import { fromUuid, toUuid } from '@quackback/ids'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { setFeatureFlag } from '../../utils/db-helpers'
import { supportEnv } from '../../support/env'
import { callServerFn } from '../../support/server-fns'
import { openStream, type OpenStream, type StreamEvent } from '../../support/streams'
import {
  createVisitor,
  openWidgetAs,
  warmUpAgentThread,
  warmUpInboxList,
  warmUpStream,
  warmUpWidgetThread,
} from '../../support/visitors'

const isMessage = (text: string) => (e: StreamEvent) =>
  e.event === 'message' &&
  typeof e.data.message?.content === 'string' &&
  e.data.message.content.includes(text)

const forConversation = (id: string) => (e: StreamEvent) =>
  e.data.conversationId === id || (e.data.conversation as { id?: string } | undefined)?.id === id

/** Text in the open admin thread, not in a list row (rows are buttons). */
function inThread(page: Page, text: string) {
  return page.getByText(text).and(page.locator(':not(button *)'))
}

/** A ticket status's TypeID by slug. */
async function ticketStatusId(slug: string): Promise<string> {
  const [row] =
    await supportDb()`SELECT id FROM ticket_statuses WHERE slug = ${slug} AND deleted_at IS NULL`
  return fromUuid('ticket_status', row.id as string)
}

function convUuid(id: string): string {
  return toUuid(id as `conversation_${string}`)
}

/** Sign a stream token the way realtime/stream-token.ts does (for refusals). */
function forgeStreamToken(payload: string): string {
  const sig = createHmac('sha256', supportEnv().app.SECRET_KEY)
    .update(`chat-stream:v1\n${payload}`)
    .digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}

test.describe('realtime: teammates and customers', () => {
  // Tickets on (turning a setting on only): the widget's ticket card needs it.
  test.beforeAll(() => setFeatureFlag('supportTickets', true))

  test(
    'RT-01 an agent reply reaches the open widget live, stripped of agent-only fields',
    { tag: '@smoke' },
    async ({ playwright, browser, people, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const agent = await newTeammate({ roleKey: 'admin', name: `Agent ${marker.slice(-6)}` })
      const agentApi = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const first = `hello ${marker}`
      const { conversationId } = await visitor.send(first)

      // Agent-only state the customer copy must not carry.
      const team = await callServerFn(agentApi, 'assignConversationTeamFn', {
        conversationId,
        teamId: people.teams.support,
      })
      expect(team.ok, team.error).toBe(true)

      const widget = await openWidgetAs(browser, visitor, first, conversationId)
      await warmUpWidgetThread(widget, agentApi, conversationId)
      const visitorStream = await visitor.openStream(conversationId)
      expect(visitorStream.status).toBe(200)
      const inbox = await openStream({ cookie: agent.cookie, query: { scope: 'inbox' } })
      await warmUpStream(visitorStream, conversationId, {
        api: agentApi,
        fn: 'sendConversationTypingFn',
      })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      const reply = `agent reply ${marker}`
      const sent = await callServerFn(agentApi, 'sendAgentMessageFn', {
        conversationId,
        content: reply,
      })
      expect(sent.ok, sent.error).toBe(true)

      await expect(widget.getByText(reply)).toBeVisible({ timeout: 10_000 })
      await expect(widget.getByText(agent.name).first()).toBeVisible()

      const frame = await visitorStream.waitFor(isMessage(reply))
      expect(frame.id).toBe(frame.data.message?.id)
      expect(frame.data.message).toMatchObject({ senderType: 'agent', isInternal: false })
      expect((frame.data.message?.author as { displayName?: string }).displayName).toBe(agent.name)
      expect(frame.raw).not.toContain(agent.email)

      const conv = visitorStream.matching(
        (e) =>
          e.event === 'conversation' &&
          (e.data.conversation as { id?: string })?.id === conversationId
      )
      expect(conv.length).toBeGreaterThan(0)
      expect(conv.at(-1)!.data.conversation).toMatchObject({
        visitorEmail: null,
        tags: [],
        sla: null,
        assignedTeamId: null,
        customAttributes: {},
        spamReason: null,
      })
      // The teammates' copy of the same conversation does carry the team.
      const agentCopy = await inbox.waitFor(
        (e) =>
          e.event === 'conversation' &&
          (e.data.conversation as { id?: string })?.id === conversationId
      )
      expect((agentCopy.data.conversation as { assignedTeamId?: string }).assignedTeamId).toBe(
        people.teams.support
      )
      await inbox.waitFor(isMessage(reply))

      visitorStream.close()
      inbox.close()
      await agentApi.dispose()
      await visitor.dispose()
    }
  )

  test(
    'RT-02 a visitor message reaches every open inbox live; a new conversation arrives before its message',
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const a = await newTeammate({ roleKey: 'support_lead' })
      const b = await newTeammate({ roleKey: 'support_lead' })
      const pageA = await a.newPage(browser)
      const pageB = await b.newPage(browser)
      await pageA.goto('/admin/inbox')
      await pageB.goto('/admin/inbox')
      const pinger = await createVisitor(playwright)
      await warmUpInboxList(pageA, pinger, marker)
      await warmUpInboxList(pageB, pinger, `b ${marker}`)
      const raw = await openStream({ cookie: a.cookie, query: { scope: 'inbox' } })

      // Warm the raw stream on a throwaway conversation, then start the real one.
      const visitor = await createVisitor(playwright)
      const warm = await visitor.send(`warm ${marker}`)
      await warmUpStream(raw, warm.conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      const opener = `new conversation ${marker}`
      const other = await createVisitor(playwright)
      const { conversationId } = await other.send(opener)

      const created = await raw.waitFor(
        (e) =>
          e.event === 'conversation' &&
          (e.data.conversation as { id?: string })?.id === conversationId
      )
      const firstMessage = await raw.waitFor(isMessage(opener))
      expect(raw.events.indexOf(created)).toBeLessThan(raw.events.indexOf(firstMessage))
      expect(firstMessage.data.conversationUpdated).toBe(true)

      for (const page of [pageA, pageB]) {
        await expect(page.getByText(opener).first()).toBeVisible({ timeout: 15_000 })
      }

      // A follow-up moves the preview in both lists, live.
      const followUp = `follow up ${marker}`
      await other.send(followUp, conversationId)
      const msg = await raw.waitFor(isMessage(followUp))
      expect(msg.data.conversationUpdated).toBeUndefined()
      for (const page of [pageA, pageB]) {
        await expect(page.getByText(followUp).first()).toBeVisible({ timeout: 15_000 })
      }
      raw.close()
      await visitor.dispose()
      await other.dispose()
    }
  )

  test(
    'RT-03 an internal note reaches the inbox but never the visitor, live or on reconnect',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'admin' })
      const agentApi = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId, messageId } = await visitor.send(`question ${marker}`)
      const visitorStream = await visitor.openStream(conversationId)
      const inbox = await openStream({ cookie: agent.cookie, query: { scope: 'inbox' } })
      await warmUpStream(visitorStream, conversationId, {
        api: agentApi,
        fn: 'sendConversationTypingFn',
      })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      const note = `secret note ${marker}`
      expect(
        (await callServerFn(agentApi, 'addConversationNoteFn', { conversationId, content: note }))
          .ok
      ).toBe(true)
      const noteFrame = await inbox.waitFor(isMessage(note))
      expect(noteFrame.data.message).toMatchObject({
        isInternal: true,
        reactions: [],
        flaggedAt: null,
      })

      const publicMarker = `public marker ${marker}`
      expect(
        (
          await callServerFn(agentApi, 'sendAgentMessageFn', {
            conversationId,
            content: publicMarker,
          })
        ).ok
      ).toBe(true)
      await visitorStream.waitFor(isMessage(publicMarker))
      expect(visitorStream.events.some((e) => e.raw.includes(note))).toBe(false)

      // Reconnect from the visitor's first message: the backfill replays the
      // public reply and leaves the note out.
      visitorStream.close()
      const again = await visitor.openStream(conversationId, messageId)
      await again.waitFor(isMessage(publicMarker))
      expect(again.events.some((e) => e.raw.includes(note))).toBe(false)

      // The note left the preview alone.
      const [row] =
        await supportDb()`SELECT last_message_preview FROM conversations WHERE id = ${convUuid(conversationId)}`
      expect(row.last_message_preview).toContain('public marker')
      again.close()
      inbox.close()
    }
  )

  test(
    'RT-04 assignment and team notices reach teammates only, live and on reload',
    { tag: '@core' },
    async ({ playwright, people, marker, newTeammate }) => {
      const actor = await newTeammate({ roleKey: 'admin' })
      const assignee = await newTeammate({
        roleKey: 'support_lead',
        name: `Assignee ${marker.slice(-6)}`,
      })
      const api = await actor.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`assign me ${marker}`)
      const visitorStream = await visitor.openStream(conversationId)
      const inbox = await openStream({ cookie: actor.cookie, query: { scope: 'inbox' } })
      await warmUpStream(visitorStream, conversationId, { api, fn: 'sendConversationTypingFn' })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      expect(
        (
          await callServerFn(api, 'assignConversationFn', {
            conversationId,
            assignTo: assignee.principalId,
          })
        ).ok
      ).toBe(true)
      const agentNotice = await inbox.waitFor(
        (e) =>
          e.event === 'message' &&
          forConversation(conversationId)(e) &&
          e.data.message?.content === `Conversation assigned to ${assignee.name}`
      )
      expect(agentNotice.data.message).toMatchObject({
        isInternal: true,
        systemEvent: { kind: 'assigned' },
      })

      expect(
        (
          await callServerFn(api, 'assignConversationTeamFn', {
            conversationId,
            teamId: people.teams.billing,
          })
        ).ok
      ).toBe(true)
      const teamNotice = await inbox.waitFor(
        (e) =>
          e.event === 'message' &&
          forConversation(conversationId)(e) &&
          /assigned to the .* team/.test(String(e.data.message?.content))
      )
      expect(teamNotice.data.message).toMatchObject({
        isInternal: true,
        systemEvent: { kind: 'team_assigned' },
      })

      // The visitor sees the assignee change, never the notices.
      const publicMarker = `public marker ${marker}`
      expect(
        (await callServerFn(api, 'sendAgentMessageFn', { conversationId, content: publicMarker }))
          .ok
      ).toBe(true)
      await visitorStream.waitFor(isMessage(publicMarker))
      expect(visitorStream.events.some((e) => e.raw.includes('Conversation assigned to'))).toBe(
        false
      )
      const visitorConv = visitorStream.matching((e) => e.event === 'conversation')
      expect(visitorConv.length).toBeGreaterThan(0)
      for (const e of visitorConv) {
        expect((e.data.conversation as { assignedTeamId?: unknown }).assignedTeamId).toBeNull()
      }

      // And a reload of the thread does not show them either.
      const listed = await callServerFn<{ messages: Array<{ content: string }> }>(
        visitor.api,
        'widgetListConversationMessagesFn',
        { conversationId },
        { method: 'GET' }
      )
      expect(listed.ok, listed.error).toBe(true)
      const contents = listed.data.messages.map((m) => m.content)
      expect(contents).toContain(publicMarker)
      expect(contents.some((c) => c.startsWith('Conversation assigned to'))).toBe(false)
      visitorStream.close()
      inbox.close()
    }
  )

  test(
    'RT-05 close and reopen notices reach both sides live',
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const agent = await newTeammate({ roleKey: 'admin' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const first = `please close ${marker}`
      const { conversationId } = await visitor.send(first)
      // A public reply first, so the thread is answered (never re-queued).
      expect(
        (
          await callServerFn(api, 'sendAgentMessageFn', {
            conversationId,
            content: `on it ${marker}`,
          })
        ).ok
      ).toBe(true)

      const widget = await openWidgetAs(browser, visitor, `on it ${marker}`, conversationId)
      const agentPage = await agent.newPage(browser)
      await agentPage.goto(`/admin/inbox?i=${conversationId}`)
      await expect(agentPage.getByText(`on it ${marker}`).first()).toBeVisible({ timeout: 15_000 })
      await warmUpAgentThread(agentPage, visitor, conversationId)
      await warmUpWidgetThread(widget, api, conversationId)
      const visitorStream = await visitor.openStream(conversationId)
      const inbox = await openStream({ cookie: agent.cookie, query: { scope: 'inbox' } })
      await warmUpStream(visitorStream, conversationId, { api, fn: 'sendConversationTypingFn' })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      const setStatus = async (status: 'closed' | 'open') => {
        const r = await callServerFn(api, 'setConversationStatusFn', { conversationId, status })
        expect(r.ok, r.error).toBe(true)
      }

      await setStatus('closed')
      for (const stream of [visitorStream, inbox]) {
        const notice = await stream.waitFor(
          (e) =>
            e.event === 'message' &&
            forConversation(conversationId)(e) &&
            e.data.message?.content === 'Conversation ended'
        )
        expect((notice.data.message?.systemEvent as { kind?: string }).kind).toBe('chat_ended')
      }
      await inbox.waitFor(
        (e) =>
          e.event === 'conversation' &&
          forConversation(conversationId)(e) &&
          (e.data.conversation as { status?: string }).status === 'closed'
      )
      await expect(widget.getByText('Conversation ended').first()).toBeVisible({ timeout: 10_000 })
      await expect(agentPage.getByText('Conversation ended').first()).toBeVisible({
        timeout: 10_000,
      })

      await setStatus('open')
      for (const stream of [visitorStream, inbox]) {
        const notice = await stream.waitFor(
          (e) =>
            e.event === 'message' &&
            forConversation(conversationId)(e) &&
            e.data.message?.content === 'Conversation reopened'
        )
        expect((notice.data.message?.systemEvent as { kind?: string }).kind).toBe('chat_reopened')
      }
      await expect(widget.getByText('Conversation reopened').first()).toBeVisible({
        timeout: 10_000,
      })
      await expect(agentPage.getByText('Conversation reopened').first()).toBeVisible({
        timeout: 10_000,
      })
      visitorStream.close()
      inbox.close()
    }
  )

  test(
    'RT-09 read receipts travel both ways live',
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const watcher = await newTeammate({ roleKey: 'support_lead' })
      const reader = await newTeammate({ roleKey: 'admin' })
      const readerApi = await reader.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`unread one ${marker}`)

      // Agent read: every teammate's inbox stream hears it, the visitor's too.
      const inbox = await openStream({ cookie: watcher.cookie, query: { scope: 'inbox' } })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })
      expect((await callServerFn(readerApi, 'markConversationReadFn', { conversationId })).ok).toBe(
        true
      )
      const agentRead = await inbox.waitFor(
        (e) => e.event === 'read' && forConversation(conversationId)(e)
      )
      expect(agentRead.data.side).toBe('agent')
      const [read] =
        await supportDb()`SELECT agent_last_read_at FROM conversations WHERE id = ${convUuid(conversationId)}`
      expect(read.agent_last_read_at).not.toBeNull()

      // Visitor read: the agent's thread marks the latest reply Seen, live.
      const reply = `seen me ${marker}`
      expect(
        (await callServerFn(readerApi, 'sendAgentMessageFn', { conversationId, content: reply })).ok
      ).toBe(true)
      const thread = await reader.newPage(browser)
      await thread.goto(`/admin/inbox?i=${conversationId}`)
      await expect(thread.getByText(reply).first()).toBeVisible({ timeout: 15_000 })
      await warmUpAgentThread(thread, visitor, conversationId)
      await expect(thread.getByText('Seen', { exact: true })).toHaveCount(0)
      const readerStream = await openStream({ cookie: reader.cookie, query: { conversationId } })
      await warmUpStream(readerStream, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })
      expect(
        (await callServerFn(visitor.api, 'widgetMarkConversationReadFn', { conversationId })).ok
      ).toBe(true)
      const visitorRead = await readerStream.waitFor((e) => e.event === 'read')
      expect(visitorRead.data.side).toBe('visitor')
      await expect(thread.getByText('Seen', { exact: true })).toBeVisible({ timeout: 10_000 })
      inbox.close()
      readerStream.close()
    }
  )

  test(
    "RT-09 an agent read clears the unread badge in another teammate's open list, live",
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const watcher = await newTeammate({ roleKey: 'support_lead' })
      const reader = await newTeammate({ roleKey: 'admin' })
      const readerApi = await reader.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`unread one ${marker}`)
      await visitor.send(`unread two ${marker}`, conversationId)

      const list = await watcher.newPage(browser)
      await list.goto('/admin/inbox')
      const row = list.getByRole('button', { name: new RegExp(visitor.name) })
      const badge = row.locator('span.rounded-full', { hasText: /^2$/ })
      await expect(badge).toBeVisible({ timeout: 15_000 })
      // The list is live: another visitor's new conversation shows up first.
      await warmUpInboxList(list, await createVisitor(playwright), marker)
      const inbox = await openStream({ cookie: watcher.cookie, query: { scope: 'inbox' } })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })
      expect((await callServerFn(readerApi, 'markConversationReadFn', { conversationId })).ok).toBe(
        true
      )
      await inbox.waitFor((e) => e.event === 'read' && forConversation(conversationId)(e))
      await expect(badge).toHaveCount(0, { timeout: 10_000 })
      inbox.close()
    }
  )

  test(
    'RT-12 editing a public reply updates both sides live; editing a note stays in the inbox',
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const agent = await newTeammate({ roleKey: 'admin' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const first = `edit thread ${marker}`
      const { conversationId } = await visitor.send(first)
      const reply = await callServerFn<{ message: { id: string } }>(api, 'sendAgentMessageFn', {
        conversationId,
        content: `original reply ${marker}`,
      })
      const note = await callServerFn<{ id?: string; message?: { id: string } }>(
        api,
        'addConversationNoteFn',
        {
          conversationId,
          content: `original note ${marker}`,
        }
      )
      expect(reply.ok && note.ok, reply.error + note.error).toBe(true)
      const noteId = note.data.message?.id ?? note.data.id
      expect(noteId).toBeTruthy()

      const widget = await openWidgetAs(
        browser,
        visitor,
        `original reply ${marker}`,
        conversationId
      )
      await expect(widget.getByText(`original reply ${marker}`)).toBeVisible({ timeout: 15_000 })
      const agentPage = await agent.newPage(browser)
      await agentPage.goto(`/admin/inbox?i=${conversationId}`)
      await expect(agentPage.getByText(`original note ${marker}`).first()).toBeVisible({
        timeout: 15_000,
      })
      await warmUpAgentThread(agentPage, visitor, conversationId)
      await warmUpWidgetThread(widget, api, conversationId)
      const visitorStream = await visitor.openStream(conversationId)
      const inbox = await openStream({ cookie: agent.cookie, query: { scope: 'inbox' } })
      await warmUpStream(visitorStream, conversationId, { api, fn: 'sendConversationTypingFn' })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      const edit = async (messageId: string, content: string) => {
        const r = await callServerFn(api, 'editConversationMessageFn', { messageId, content })
        expect(r.ok, r.error).toBe(true)
      }
      await edit(reply.data.message.id, `edited reply ${marker}`)
      await visitorStream.waitFor(
        (e) => e.event === 'message_edited' && e.raw.includes(`edited reply ${marker}`)
      )
      await inbox.waitFor(
        (e) => e.event === 'message_updated' && e.raw.includes(`edited reply ${marker}`)
      )
      await expect(widget.getByText(`edited reply ${marker}`)).toBeVisible({ timeout: 10_000 })
      await expect(agentPage.getByText(`edited reply ${marker}`).first()).toBeVisible({
        timeout: 10_000,
      })

      await edit(noteId!, `edited note ${marker}`)
      await inbox.waitFor(
        (e) => e.event === 'message_updated' && e.raw.includes(`edited note ${marker}`)
      )
      await expect(agentPage.getByText(`edited note ${marker}`).first()).toBeVisible({
        timeout: 10_000,
      })
      const publicMarker = `marker ${marker}`
      expect(
        (await callServerFn(api, 'sendAgentMessageFn', { conversationId, content: publicMarker }))
          .ok
      ).toBe(true)
      await visitorStream.waitFor(isMessage(publicMarker))
      expect(visitorStream.events.some((e) => e.raw.includes('note'))).toBe(false)
      await expect(widget.getByText(`edited note ${marker}`)).toHaveCount(0)
      visitorStream.close()
      inbox.close()
    }
  )

  test(
    'RT-13 deleting a public reply removes it on both sides live; deleting a note stays in the inbox',
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const agent = await newTeammate({ roleKey: 'admin' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const first = `delete thread ${marker}`
      const { conversationId } = await visitor.send(first)
      const keep = await callServerFn(api, 'sendAgentMessageFn', {
        conversationId,
        content: `kept reply ${marker}`,
      })
      const reply = await callServerFn<{ message: { id: string } }>(api, 'sendAgentMessageFn', {
        conversationId,
        content: `doomed reply ${marker}`,
      })
      const note = await callServerFn<{ id?: string; message?: { id: string } }>(
        api,
        'addConversationNoteFn',
        {
          conversationId,
          content: `doomed note ${marker}`,
        }
      )
      expect(keep.ok && reply.ok && note.ok).toBe(true)
      const noteId = (note.data.message?.id ?? note.data.id)!

      const widget = await openWidgetAs(browser, visitor, `doomed reply ${marker}`, conversationId)
      await expect(widget.getByText(`doomed reply ${marker}`)).toBeVisible({ timeout: 15_000 })
      const agentPage = await agent.newPage(browser)
      await agentPage.goto(`/admin/inbox?i=${conversationId}`)
      await expect(agentPage.getByText(`doomed note ${marker}`).first()).toBeVisible({
        timeout: 15_000,
      })
      await warmUpAgentThread(agentPage, visitor, conversationId)
      await warmUpWidgetThread(widget, api, conversationId)
      const visitorStream = await visitor.openStream(conversationId)
      const inbox = await openStream({ cookie: agent.cookie, query: { scope: 'inbox' } })
      await warmUpStream(visitorStream, conversationId, { api, fn: 'sendConversationTypingFn' })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      const replyId = reply.data.message.id
      expect(
        (await callServerFn(api, 'deleteConversationMessageFn', { messageId: replyId })).ok
      ).toBe(true)
      for (const stream of [visitorStream, inbox]) {
        const gone = await stream.waitFor(
          (e) => e.event === 'message_deleted' && e.data.messageId === replyId
        )
        expect(gone.data.conversationId).toBe(conversationId)
      }
      await expect(widget.getByText(`doomed reply ${marker}`)).toHaveCount(0, { timeout: 10_000 })
      await expect(inThread(agentPage, `doomed reply ${marker}`)).toHaveCount(0, {
        timeout: 10_000,
      })
      await expect(widget.getByText(`kept reply ${marker}`)).toBeVisible()

      expect(
        (await callServerFn(api, 'deleteConversationMessageFn', { messageId: noteId })).ok
      ).toBe(true)
      await inbox.waitFor((e) => e.event === 'message_deleted' && e.data.messageId === noteId)
      await expect(inThread(agentPage, `doomed note ${marker}`)).toHaveCount(0, { timeout: 10_000 })
      const publicMarker = `marker ${marker}`
      expect(
        (await callServerFn(api, 'sendAgentMessageFn', { conversationId, content: publicMarker }))
          .ok
      ).toBe(true)
      await visitorStream.waitFor(isMessage(publicMarker))
      expect(visitorStream.matching((e) => e.data.messageId === noteId)).toEqual([])

      // The public delete wrote a message.deleted event; the note delete did not.
      const events = await pollFor('the message.deleted event', async () => {
        const rows =
          await supportDb()`SELECT 1 FROM events WHERE type = 'message.deleted' AND payload::text LIKE ${`%${replyId}%`}`
        return rows.length > 0 ? rows : null
      })
      expect(events).toHaveLength(1)
      const noteEvents =
        await supportDb()`SELECT 1 FROM events WHERE type = 'message.deleted' AND payload::text LIKE ${`%${noteId}%`}`
      expect(noteEvents).toHaveLength(0)
      visitorStream.close()
      inbox.close()
    }
  )

  test(
    'RT-36 the linked ticket card appears and updates in the open widget thread',
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const agent = await newTeammate({ roleKey: 'admin' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const first = `ticket me ${marker}`
      const { conversationId } = await visitor.send(first)
      expect(
        (
          await callServerFn(api, 'sendAgentMessageFn', {
            conversationId,
            content: `filing ${marker}`,
          })
        ).ok
      ).toBe(true)
      const widget = await openWidgetAs(browser, visitor, `filing ${marker}`, conversationId)
      await expect(widget.getByText(`filing ${marker}`)).toBeVisible({ timeout: 15_000 })
      await warmUpWidgetThread(widget, api, conversationId)

      const title = `Ticket ${marker}`
      const created = await callServerFn<{ id: string }>(api, 'createTicketFn', {
        type: 'customer',
        title,
        conversationId,
        requesterPrincipalId: await visitor.principalId(),
      })
      expect(created.ok, created.error).toBe(true)
      const linked = await callServerFn(api, 'linkTicketToConversationFn', {
        ticketId: created.data.id,
        conversationId,
      })
      expect(linked.ok, linked.error).toBe(true)
      await expect(widget.getByText(/created from this conversation/)).toBeVisible({
        timeout: 10_000,
      })
      await expect(widget.getByText(title)).toBeVisible({ timeout: 10_000 })
      await expect(widget.getByText('Received').first()).toBeVisible()

      const moved = await callServerFn(api, 'setTicketStatusFn', {
        ticketId: created.data.id,
        statusId: await ticketStatusId('investigating'),
      })
      expect(moved.ok, moved.error).toBe(true)
      await expect(widget.getByText('In progress').first()).toBeVisible({ timeout: 10_000 })
      // Still the same thread: nothing navigated.
      await expect(widget.getByText(`filing ${marker}`)).toBeVisible()
    }
  )

  test(
    'RT-16 a reconnect with Last-Event-ID replays missed public messages in order, without deleted ones',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'admin' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId, messageId } = await visitor.send(`start ${marker}`)

      // Missed while disconnected: two replies, a note, and a reply deleted again.
      const send = async (content: string) => {
        const r = await callServerFn<{ message: { id: string } }>(api, 'sendAgentMessageFn', {
          conversationId,
          content,
        })
        expect(r.ok, r.error).toBe(true)
        return r.data.message.id
      }
      await send(`missed one ${marker}`)
      const deletedId = await send(`missed deleted ${marker}`)
      expect(
        (
          await callServerFn(api, 'addConversationNoteFn', {
            conversationId,
            content: `missed note ${marker}`,
          })
        ).ok
      ).toBe(true)
      await send(`missed two ${marker}`)
      expect(
        (await callServerFn(api, 'deleteConversationMessageFn', { messageId: deletedId })).ok
      ).toBe(true)

      const visitorStream = await visitor.openStream(conversationId, messageId)
      const one = await visitorStream.waitFor(isMessage(`missed one ${marker}`))
      const two = await visitorStream.waitFor(isMessage(`missed two ${marker}`))
      expect(visitorStream.events.indexOf(one)).toBeLessThan(visitorStream.events.indexOf(two))
      expect(visitorStream.events.some((e) => e.raw.includes(`missed deleted ${marker}`))).toBe(
        false
      )
      expect(visitorStream.events.some((e) => e.raw.includes(`missed note ${marker}`))).toBe(false)

      // A teammate's reconnect includes the note; nothing is sent twice.
      const agentStream = await openStream({
        cookie: agent.cookie,
        query: { conversationId },
        lastEventId: messageId,
      })
      await agentStream.waitFor(isMessage(`missed note ${marker}`))
      await agentStream.waitFor(isMessage(`missed two ${marker}`))
      const live = `live after ${marker}`
      await send(live)
      await agentStream.waitFor(isMessage(live))
      const ids = agentStream.events
        .filter((e) => e.event === 'message')
        .map((e) => e.data.message?.id)
      expect(new Set(ids).size).toBe(ids.length)

      // A Last-Event-ID from another conversation replays nothing.
      const other = await visitor.send(`other ${marker}`)
      const foreign = await visitor.openStream(conversationId, other.messageId)
      await warmUpStream(foreign, conversationId, { api, fn: 'sendConversationTypingFn' })
      expect(foreign.matching((e) => e.event === 'message')).toEqual([])
      for (const s of [visitorStream, agentStream, foreign]) s.close()
    }
  )

  test(
    'RT-24 the stream refuses missing, tampered, expired and unscoped credentials and the wrong audience',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`refusals ${marker}`)
      const principalId = await visitor.principalId()
      const good = await visitor.streamToken()

      const status = async (query: Record<string, string>, cookie?: string) => {
        const s: OpenStream = await openStream({ query, cookie })
        s.close()
        return s.status
      }

      expect(await status({ conversationId })).toBe(401)
      expect(await status({ conversationId, token: `${good.slice(0, -2)}xx` })).toBe(401)
      expect(
        await status({
          conversationId,
          token: forgeStreamToken(`${principalId}.widget.${Date.now() - 1000}`),
        })
      ).toBe(401)
      expect(
        await status({
          conversationId,
          token: forgeStreamToken(`${principalId}.${Date.now() + 60_000}`),
        })
      ).toBe(401)
      // The same signer accepts a fresh token, so the refusals above are about the token.
      expect(
        await status({
          conversationId,
          token: forgeStreamToken(`${principalId}.widget.${Date.now() + 60_000}`),
        })
      ).toBe(200)

      expect(await status({ scope: 'inbox', token: good })).toBe(403)
      // A teammate's portal-audience token is not an inbox credential.
      // (A test's own teammate: an inbox stream marks its owner online.)
      const teammate = (await newTeammate({ roleKey: 'support_lead' })).principalId
      expect(
        await status({
          scope: 'inbox',
          token: forgeStreamToken(`${teammate}.portal.${Date.now() + 60_000}`),
        })
      ).toBe(403)
      expect(
        await status({
          scope: 'inbox',
          token: forgeStreamToken(`${teammate}.dashboard.${Date.now() + 60_000}`),
        })
      ).toBe(200)
      expect(await status({ token: good })).toBe(400)

      const stranger = await createVisitor(playwright)
      await stranger.send(`stranger ${marker}`)
      expect(await status({ conversationId, token: await stranger.streamToken() })).toBe(404)
      await visitor.dispose()
      await stranger.dispose()
    }
  )
})

test.describe('realtime: nightly', () => {
  test.beforeAll(() => setFeatureFlag('supportTickets', true))

  test(
    'RT-06 visitor typing shows in the open thread, clears on their message, and never echoes back',
    { tag: '@nightly' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const agent = await newTeammate({ roleKey: 'admin' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`typing ${marker}`)
      const own = await visitor.openStream(conversationId)
      await warmUpStream(own, conversationId, { api, fn: 'sendConversationTypingFn' })
      const page = await agent.newPage(browser)
      await page.goto(`/admin/inbox?i=${conversationId}`)
      // The warm-up itself is the journey: the visitor types, the thread shows it.
      await warmUpAgentThread(page, visitor, conversationId)
      const indicator = page.getByText(`${visitor.name} is typing…`)
      await expect(indicator).toBeVisible()
      // Their next message clears it at once (well inside the 4 s window).
      await visitor.send(`typed ${marker}`, conversationId)
      await expect(indicator).toHaveCount(0, { timeout: 2_500 })
      // And left alone it clears by itself after about 4 s.
      await callServerFn(visitor.api, 'widgetSendConversationTypingFn', { conversationId })
      await expect(indicator).toBeVisible({ timeout: 5_000 })
      await expect(indicator).toHaveCount(0, { timeout: 8_000 })
      // The visitor's own stream never got a visitor-side typing frame.
      await own.waitFor(isMessage(`typed ${marker}`))
      expect(own.matching((e) => e.event === 'typing' && e.data.side === 'visitor')).toEqual([])
      own.close()
    }
  )

  test(
    "RT-07 agent typing reaches the visitor without the agent's identity",
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'admin' })
      const watcher = await newTeammate({ roleKey: 'support_lead' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`who types ${marker}`)
      const visitorStream = await visitor.openStream(conversationId)
      const inbox = await openStream({ cookie: watcher.cookie, query: { scope: 'inbox' } })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })
      await warmUpStream(visitorStream, conversationId, { api, fn: 'sendConversationTypingFn' })
      const visitorFrame = visitorStream.matching((e) => e.event === 'typing').at(-1)!
      expect(visitorFrame.data.side).toBe('agent')
      expect(visitorFrame.data.typistPrincipalId).toBeUndefined()
      expect(visitorFrame.raw).not.toContain(agent.principalId)
      const agentFrame = await inbox.waitFor(
        (e) =>
          e.event === 'typing' &&
          e.data.side === 'agent' &&
          e.data.conversationId === conversationId
      )
      expect(agentFrame.data.typistPrincipalId).toBe(agent.principalId)
      visitorStream.close()
      inbox.close()
    }
  )

  test(
    'RT-08 another agent typing shows a collision notice, with no echo to the typist',
    { tag: '@nightly' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const a = await newTeammate({ roleKey: 'admin' })
      const b = await newTeammate({ roleKey: 'admin' })
      const bApi = await b.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`collide ${marker}`)
      const page = await a.newPage(browser)
      await page.goto(`/admin/inbox?i=${conversationId}`)
      await warmUpAgentThread(page, visitor, conversationId)
      const bStream = await openStream({ cookie: b.cookie, query: { scope: 'inbox' } })
      await warmUpStream(bStream, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      const notice = page.getByText('Another agent is replying…')
      await expect(async () => {
        await callServerFn(bApi, 'sendConversationTypingFn', { conversationId })
        await expect(notice).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      // B's own inbox stream never carries B's typing.
      expect(
        bStream.matching((e) => e.event === 'typing' && e.data.typistPrincipalId === b.principalId)
      ).toEqual([])
      // Any agent message clears it.
      expect(
        (
          await callServerFn(bApi, 'sendAgentMessageFn', {
            conversationId,
            content: `took it ${marker}`,
          })
        ).ok
      ).toBe(true)
      await expect(notice).toHaveCount(0, { timeout: 3_000 })
      bStream.close()
    }
  )

  test(
    "RT-10 mark unread from here stays on the teammates' side",
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'admin' })
      const watcher = await newTeammate({ roleKey: 'support_lead' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const first = await visitor.send(`one ${marker}`)
      const { conversationId } = first
      await visitor.send(`two ${marker}`, conversationId)
      expect((await callServerFn(api, 'markConversationReadFn', { conversationId })).ok).toBe(true)
      const visitorStream = await visitor.openStream(conversationId)
      const inbox = await openStream({ cookie: watcher.cookie, query: { scope: 'inbox' } })
      await warmUpStream(visitorStream, conversationId, { api, fn: 'sendConversationTypingFn' })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      const r = await callServerFn(api, 'markConversationUnreadFromMessageFn', {
        conversationId,
        messageId: first.messageId,
      })
      expect(r.ok, r.error).toBe(true)
      const rewound = await inbox.waitFor(
        (e) => e.event === 'read' && forConversation(conversationId)(e)
      )
      expect(rewound.data.side).toBe('agent')
      const [row] = await supportDb()`SELECT created_at FROM conversation_messages
      WHERE id = ${toUuid(first.messageId as `conversation_msg_${string}`)}`
      expect(new Date(String(rewound.data.at)).getTime()).toBeLessThan(
        (row.created_at as Date).getTime()
      )

      const publicMarker = `marker ${marker}`
      expect(
        (await callServerFn(api, 'sendAgentMessageFn', { conversationId, content: publicMarker }))
          .ok
      ).toBe(true)
      await visitorStream.waitFor(isMessage(publicMarker))
      expect(
        visitorStream.matching(
          (e) => e.event === 'read' && e.data.side === 'agent' && e.data.at === rewound.data.at
        )
      ).toEqual([])

      // A deleted anchor is not found.
      const doomed = await callServerFn<{ message: { id: string } }>(api, 'sendAgentMessageFn', {
        conversationId,
        content: `doomed ${marker}`,
      })
      expect(
        (
          await callServerFn(api, 'deleteConversationMessageFn', {
            messageId: doomed.data.message.id,
          })
        ).ok
      ).toBe(true)
      const gone = await callServerFn(api, 'markConversationUnreadFromMessageFn', {
        conversationId,
        messageId: doomed.data.message.id,
      })
      expect(gone.ok).toBe(false)
      expect(gone.code).toBe('MESSAGE_NOT_FOUND')
      visitorStream.close()
      inbox.close()
    }
  )

  test(
    'RT-11 reactions and flags reach teammates only; system and hidden messages refuse',
    { tag: '@nightly' },
    async ({ playwright, people, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'admin' })
      const watcher = await newTeammate({ roleKey: 'support_lead' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId, messageId } = await visitor.send(`react ${marker}`)
      const visitorStream = await visitor.openStream(conversationId)
      const inbox = await openStream({ cookie: watcher.cookie, query: { scope: 'inbox' } })
      await warmUpStream(visitorStream, conversationId, { api, fn: 'sendConversationTypingFn' })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      expect((await callServerFn(api, 'addMessageReactionFn', { messageId, emoji: '👍' })).ok).toBe(
        true
      )
      const reacted = await inbox.waitFor(
        (e) => e.event === 'message_updated' && e.data.message?.id === messageId
      )
      expect(JSON.stringify(reacted.data.message?.reactions)).toContain('👍')
      // A flag is the flagging teammate's own (no broadcast): it is stored.
      const flag = await callServerFn<{ flaggedAt: string | null }>(api, 'setMessageFlagFn', {
        messageId,
        flagged: true,
      })
      expect(flag.ok, flag.error).toBe(true)
      expect(flag.data.flaggedAt).not.toBeNull()

      const publicMarker = `marker ${marker}`
      expect(
        (await callServerFn(api, 'sendAgentMessageFn', { conversationId, content: publicMarker }))
          .ok
      ).toBe(true)
      await visitorStream.waitFor(isMessage(publicMarker))
      expect(visitorStream.matching((e) => e.event === 'message_updated')).toEqual([])

      // A system notice cannot be reacted to.
      expect(
        (
          await callServerFn(api, 'assignConversationTeamFn', {
            conversationId,
            teamId: people.teams.support,
          })
        ).ok
      ).toBe(true)
      const notice = await inbox.waitFor(
        (e) =>
          e.event === 'message' &&
          forConversation(conversationId)(e) &&
          Boolean(e.data.message?.systemEvent)
      )
      const sys = await callServerFn(api, 'addMessageReactionFn', {
        messageId: notice.data.message!.id,
        emoji: '👍',
      })
      expect(sys.ok).toBe(false)
      expect(sys.code).toBe('FORBIDDEN')
      expect(sys.error).toContain('System messages cannot be reacted to or flagged')

      // On the Support team now: hidden from a Billing-only teammate.
      const scoped = await newTeammate({
        roleKey: 'e2e_scoped_agent',
        teams: [people.teams.billing],
      })
      const hidden = await callServerFn(await scoped.api(playwright), 'addMessageReactionFn', {
        messageId,
        emoji: '🎉',
      })
      expect(hidden.ok).toBe(false)
      expect(hidden.code).toBe('MESSAGE_NOT_FOUND')
      visitorStream.close()
      inbox.close()
    }
  )

  test(
    'RT-26 a raw ticket stream carries ticket updates, messages and reads; others are refused',
    { tag: '@nightly' },
    async ({ playwright, people, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'admin' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      await visitor.send(`requester ${marker}`)
      // A back-office ticket keeps its own thread (a customer ticket's reads
      // go to its paired conversation instead).
      const created = await callServerFn<{ id: string }>(api, 'createTicketFn', {
        type: 'back_office',
        title: `Stream ${marker}`,
      })
      expect(created.ok, created.error).toBe(true)
      const ticketId = created.data.id
      const stream = await openStream({ cookie: agent.cookie, query: { ticketId } })
      expect(stream.status).toBe(200)
      // Warm up: a status change until its frame arrives.
      await expect(async () => {
        await callServerFn(api, 'setTicketStatusFn', {
          ticketId,
          statusId: await ticketStatusId('investigating'),
        })
        await stream.waitFor((e) => e.event === 'ticket_updated', 1_000)
      }).toPass({ timeout: 15_000 })
      expect(
        (
          await callServerFn(api, 'sendTicketMessageFn', {
            ticketId,
            content: `ticket reply ${marker}`,
          })
        ).ok
      ).toBe(true)
      await stream.waitFor(
        (e) => e.event === 'ticket_message' && e.raw.includes(`ticket reply ${marker}`)
      )
      expect((await callServerFn(api, 'markTicketReadFn', { ticketId })).ok).toBe(true)
      await stream.waitFor((e) => e.event === 'ticket_read')
      stream.close()

      const customer = await openStream({ person: 'customer', query: { ticketId } })
      expect(customer.status).toBe(403)
      const missing = await openStream({
        cookie: agent.cookie,
        query: { ticketId: `ticket_${'0'.repeat(26)}` },
      })
      expect(missing.status).toBe(404)
      // Assigned to the Support team: hidden from a Billing-only teammate.
      expect(
        (
          await callServerFn(api, 'assignTicketFn', {
            ticketId,
            assigneeTeamId: people.teams.support,
          })
        ).ok
      ).toBe(true)
      const scoped = await newTeammate({
        roleKey: 'e2e_scoped_agent',
        teams: [people.teams.billing],
      })
      const hidden = await openStream({ cookie: scoped.cookie, query: { ticketId } })
      expect(hidden.status).toBe(404)
    }
  )

  test(
    'RT-30 an oversized reply spills to the overflow table and still arrives whole',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'admin' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`big ${marker}`)
      const visitorStream = await visitor.openStream(conversationId)
      await warmUpStream(visitorStream, conversationId, { api, fn: 'sendConversationTypingFn' })
      // About 12 KB: 3-byte characters, under the 4,000-character limit.
      const big = `${marker} ${'語'.repeat(3_900)}`
      const sentAt = new Date(Date.now() - 1000)
      expect(
        (await callServerFn(api, 'sendAgentMessageFn', { conversationId, content: big })).ok
      ).toBe(true)
      const frame = await visitorStream.waitFor(isMessage(marker))
      expect(frame.data.message?.content).toBe(big)
      const [spill] = await supportDb()`SELECT expires_at FROM realtime_overflow
      WHERE payload::text LIKE ${`%${marker}%`} ORDER BY id DESC LIMIT 1`
      expect(spill).toBeTruthy()
      const expires = (spill.expires_at as Date).getTime()
      expect(expires).toBeGreaterThan(sentAt.getTime() + 55_000)
      expect(expires).toBeLessThanOrEqual(Date.now() + 61_000)
      visitorStream.close()
    }
  )

  test(
    'RT-34 filing as spam and restoring reach both sides, and the visitor never sees why',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'admin' })
      const api = await agent.api(playwright)
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`buy now ${marker}`)
      const visitorStream = await visitor.openStream(conversationId)
      const inbox = await openStream({ cookie: agent.cookie, query: { scope: 'inbox' } })
      await warmUpStream(visitorStream, conversationId, { api, fn: 'sendConversationTypingFn' })
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      const filed = await callServerFn(api, 'endConversationFn', { conversationId, reason: 'spam' })
      expect(filed.ok, filed.error).toBe(true)
      const conv = (e: StreamEvent) =>
        e.data.conversation as { id?: string; endReason?: string | null; spamReason?: unknown }
      const isFiled = (e: StreamEvent) =>
        e.event === 'conversation' && conv(e)?.id === conversationId && conv(e).endReason === 'spam'
      const agentCopy = await inbox.waitFor(isFiled)
      const visitorCopy = await visitorStream.waitFor(
        (e) => e.event === 'conversation' && conv(e)?.id === conversationId
      )
      expect(conv(visitorCopy).spamReason).toBeNull()
      expect(agentCopy).toBeTruthy()

      const restored = await callServerFn(api, 'restoreConversationFromSpamFn', { conversationId })
      expect(restored.ok, restored.error).toBe(true)
      await inbox.waitFor(
        (e) =>
          e.event === 'conversation' &&
          conv(e)?.id === conversationId &&
          conv(e).endReason !== 'spam'
      )
      await visitorStream.waitFor(
        (e) => e.event === 'conversation' && conv(e)?.id === conversationId
      )
      for (const e of visitorStream.matching((x) => x.event === 'conversation'))
        expect(conv(e).spamReason).toBeNull()
      visitorStream.close()
      inbox.close()
    }
  )
})
