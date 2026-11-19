/**
 * The widget messenger from the customer's side (area CUS-W): a visitor
 * writes, a teammate answers, the visitor sees it live, and what the team
 * keeps to itself never reaches the widget.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  agentApi,
  composer,
  conversationRow,
  conversationWithMessage,
  inboxWrite,
  mintVisitor,
  openWidget,
  openWidgetThread,
  visitorSend,
  visitorType,
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
      await openWidgetThread(widget, opening)
      await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })

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
      await openWidgetThread(widget, opening)
      await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })

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
