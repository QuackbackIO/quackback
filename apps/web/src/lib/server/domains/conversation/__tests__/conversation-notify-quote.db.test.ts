/**
 * A correspondence-channel reply email quotes the message before the reply, the
 * way a mail client does. System events (assignments, closes, stage changes)
 * are notices on the thread, not correspondence: they have no author and must
 * never be quoted as something the customer wrote.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, conversations, conversationMessages } from '@/lib/server/db'

const sendEmail = vi.hoisted(() =>
  vi.fn<(options: Record<string, unknown>) => Promise<{ sent: boolean }>>()
)

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@quackback/email', async (original) => ({
  ...(await original<typeof import('@quackback/email')>()),
  sendConversationMessageEmail: sendEmail,
}))

import { sendVisitorConversationEmail } from '../conversation.notify'

const fixture = await createDbTestFixture()

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  sendEmail.mockReset().mockResolvedValue({ sent: true })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function replyAfter(previous: Array<{ senderType: 'visitor' | 'system'; content: string }>) {
  const [visitor] = await testDb
    .insert(principal)
    .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor.id, channel: 'email', customAttributes: {} })
    .returning()
  const start = Date.parse('2026-07-01T10:00:00.000Z')
  const rows = [...previous, { senderType: 'agent' as const, content: 'The reply' }]
  await testDb.insert(conversationMessages).values(
    rows.map((row, i) => ({
      conversationId: conversation.id,
      senderType: row.senderType,
      content: row.content,
      principalId: row.senderType === 'visitor' ? visitor.id : null,
      createdAt: new Date(start + i * 60_000),
    }))
  )
  await sendVisitorConversationEmail({
    conversationId: conversation.id,
    visitorPrincipalId: visitor.id,
    recipient: 'customer@example.com',
    direction: 'agent_reply',
    senderName: 'Support',
    content: 'The reply',
    ctaUrl: 'https://acme.example.com',
    ctx: { workspaceName: 'Acme', logoUrl: null },
    channel: 'email',
  })
  expect(sendEmail).toHaveBeenCalledTimes(1)
  return sendEmail.mock.calls[0][0].quotedPrevious as { text: string } | undefined
}

it('quotes the customer message before the reply', async () => {
  const quoted = await replyAfter([{ senderType: 'visitor', content: 'The question' }])
  expect(quoted?.text).toBe('The question')
})

it('skips system events between the customer message and the reply', async () => {
  const quoted = await replyAfter([
    { senderType: 'visitor', content: 'The question' },
    { senderType: 'system', content: 'Conversation assigned to the Billing team' },
  ])
  expect(quoted?.text).toBe('The question')
})

it('quotes nothing when only system events precede the reply', async () => {
  const quoted = await replyAfter([
    { senderType: 'system', content: 'Conversation assigned to the Billing team' },
  ])
  expect(quoted).toBeUndefined()
})
