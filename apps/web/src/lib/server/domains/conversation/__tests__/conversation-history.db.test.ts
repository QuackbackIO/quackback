/**
 * What the team keeps after a message changes, against a real database: an edit
 * keeps the body it replaced, a delete keeps a placeholder only agents load, and
 * a redaction removes the content from every place it was stored. Real DB,
 * rolled back.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type ConversationMessageId, type PrincipalId } from '@quackback/ids'

process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  principal,
  conversations,
  conversationMessages,
  conversationMessageEdits,
  conversationMessageTranslations,
  inAppNotifications,
  eq,
  sql,
} from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishConversationOnlyEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishTicketEvent: vi.fn(),
}))

vi.mock('../conversation.webhooks', async (orig) => ({
  ...(await orig<typeof import('../conversation.webhooks')>()),
  emitMessageDeleted: vi.fn().mockResolvedValue(undefined),
  emitMessageUpdated: vi.fn().mockResolvedValue(undefined),
}))

const deleteObject = vi.fn(async (_key: string) => {})
vi.mock('@/lib/server/storage/s3', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/storage/s3')>()),
  deleteObject: (key: string) => deleteObject(key),
}))

import { redactConversationMessage, listConversationMessageEdits } from '../conversation.history'
import { editConversationMessage } from '../conversation.edit'
import { deleteConversationMessage } from '../conversation.service'
import { listMessages } from '../conversation.query'
import {
  publishConversationOnlyEvent,
  publishAgentConversationEvent,
} from '@/lib/server/realtime/conversation-channels'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversationMessageEdits.id }).from(conversationMessageEdits).limit(0)
    await db
      .select({ redactedAt: conversationMessages.redactedAt })
      .from(conversationMessages)
      .limit(0)
  },
})

const SECRET = 'hunter2-card-4242'

async function seed() {
  const [agent] = await testDb
    .insert(principal)
    .values({
      id: createId('principal'),
      role: 'admin',
      type: 'user',
      displayName: 'Ava Agent',
      createdAt: new Date(),
    })
    .returning()
  const [visitor] = await testDb
    .insert(principal)
    .values({
      id: createId('principal'),
      role: 'user',
      type: 'anonymous',
      displayName: 'Vic Visitor',
      createdAt: new Date(),
    })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor.id, channel: 'messenger' })
    .returning()
  const at = (s: number) => new Date(Date.UTC(2026, 8, 23, 10, 0, s))
  const [earlier] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      principalId: agent.id,
      senderType: 'agent',
      content: 'Happy to help',
      createdAt: at(0),
    })
    .returning()
  const [leaked] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      principalId: visitor.id,
      senderType: 'visitor',
      content: `My password is ${SECRET}`,
      contentJson: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: `My password is ${SECRET}` }] },
          { type: 'image', attrs: { src: '/api/storage/widget-media/2026/09/a-shot.png' } },
          { type: 'image', attrs: { src: '/api/storage/post-images/2026/09/shared.png' } },
          { type: 'image', attrs: { src: 'https://cdn.example.com/elsewhere.png' } },
        ],
      },
      attachments: [
        {
          url: '/api/storage/chat-files/2026/09/b-statement.pdf',
          name: `statement-${SECRET}.pdf`,
          contentType: 'application/pdf',
          size: 10,
        },
      ],
      metadata: {
        source: 'email',
        emailMessageId: '<m1@mail.test>',
        subject: `Re: ${SECRET}`,
        cc: ['someone@example.com'],
      },
      createdAt: at(1),
    })
    .returning()
  await testDb
    .update(conversations)
    .set({ lastMessagePreview: leaked.content })
    .where(eq(conversations.id, conversation.id))
  return { agent, visitor, conversation, earlier, leaked }
}

function actorFor(p: { id: string; role: string }, permissions?: string[]): Actor {
  return {
    principalId: p.id as PrincipalId,
    role: p.role as Actor['role'],
    principalType: p.role === 'user' ? 'anonymous' : 'user',
    segmentIds: new Set(),
    ...(permissions ? { permissions: new Set(permissions as never[]) } : {}),
  }
}

/** Every stored copy of the secret, across the tables a message spreads into. */
async function secretCopies(): Promise<number> {
  const needle = `%${SECRET}%`
  const [row] = await testDb.execute<{ n: number }>(sql`
    SELECT (
      (SELECT count(*) FROM conversation_messages m WHERE m::text ILIKE ${needle})
      + (SELECT count(*) FROM conversation_message_edits e WHERE e::text ILIKE ${needle})
      + (SELECT count(*) FROM conversation_message_translations t WHERE t::text ILIKE ${needle})
      + (SELECT count(*) FROM in_app_notifications n WHERE n::text ILIKE ${needle})
      + (SELECT count(*) FROM conversations c WHERE c::text ILIKE ${needle})
    )::int AS n`)
  return Number(row?.n ?? 0)
}

describe.skipIf(!fixture.available)('message history (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => vi.clearAllMocks())
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('redaction removes the content from every place it was stored', async () => {
    const { agent, conversation, leaked } = await seed()
    await testDb.insert(conversationMessageEdits).values({
      messageId: leaked.id,
      editorPrincipalId: leaked.principalId,
      previousContent: `first draft ${SECRET}`,
      previousContentJson: {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: '/api/storage/chat-images/2026/09/c-old.png' } }],
      },
    })
    await testDb.insert(conversationMessageTranslations).values({
      conversationMessageId: leaked.id,
      locale: 'fr',
      content: `Mon mot de passe est ${SECRET}`,
    })
    await testDb.insert(inAppNotifications).values({
      principalId: agent.id,
      type: 'chat_message',
      title: 'New message from Vic Visitor',
      body: `My password is ${SECRET}`,
      metadata: { conversationId: conversation.id, conversationMessageId: leaked.id },
    })
    expect(await secretCopies()).toBeGreaterThanOrEqual(5)

    const dto = await redactConversationMessage(leaked.id as ConversationMessageId, actorFor(agent))

    expect(await secretCopies()).toBe(0)
    const [row] = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.id, leaked.id))
    expect(row).toMatchObject({
      content: '',
      contentJson: null,
      attachments: null,
      redactedByPrincipalId: agent.id,
      deletedByPrincipalId: agent.id,
    })
    expect(row.redactedAt).toBeInstanceOf(Date)
    expect(row.deletedAt).toBeInstanceOf(Date)
    // Routing and dedupe keys survive; subject and cc do not.
    expect(row.metadata).toEqual({ source: 'email', emailMessageId: '<m1@mail.test>' })
    // The list preview falls back to the newest message still visible.
    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id))
    expect(conv.lastMessagePreview).toBe('Happy to help')
    // Only this message's own uploads are deleted, never shared or foreign ones.
    expect(deleteObject.mock.calls.map(([k]) => k).sort()).toEqual([
      'chat-files/2026/09/b-statement.pdf',
      'chat-images/2026/09/c-old.png',
      'widget-media/2026/09/a-shot.png',
    ])
    expect(dto).toMatchObject({ redactedAt: expect.any(String), redactedByName: 'Ava Agent' })
    // The customer loses the message; agents get the placeholder.
    expect(publishConversationOnlyEvent).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({ kind: 'message_deleted', messageId: leaked.id })
    )
    expect(publishAgentConversationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message_updated' })
    )
  })

  it('only a moderator can redact', async () => {
    const { agent, leaked } = await seed()
    const replier = actorFor(agent, [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.CONVERSATION_REPLY])
    await expect(
      redactConversationMessage(leaked.id as ConversationMessageId, replier)
    ).rejects.toThrow(ForbiddenError)
    expect(await secretCopies()).toBeGreaterThan(0)
  })

  it('a delete keeps the message as a placeholder that only agent reads load', async () => {
    const { visitor, conversation, leaked } = await seed()
    await deleteConversationMessage(leaked.id as ConversationMessageId, actorFor(visitor))

    const customerView = await listMessages(conversation.id)
    expect(customerView.messages.map((m) => m.id)).not.toContain(leaked.id)

    const agentView = await listMessages(conversation.id, {
      includeInternal: true,
      includeDeleted: true,
    })
    const placeholder = agentView.messages.find((m) => m.id === leaked.id)
    expect(placeholder).toMatchObject({
      deletedAt: expect.any(String),
      deletedByName: 'Vic Visitor',
      content: `My password is ${SECRET}`,
    })
    // The preview stops quoting the deleted message.
    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id))
    expect(conv.lastMessagePreview).toBe('Happy to help')
  })

  it('an edit keeps every earlier version, newest first, for the team only', async () => {
    const { agent, visitor, earlier } = await seed()
    const me = actorFor(agent)
    await editConversationMessage(earlier.id as ConversationMessageId, 'Happy to help!', null, me)
    await editConversationMessage(earlier.id as ConversationMessageId, 'Glad to help!', null, me)

    const versions = await listConversationMessageEdits(earlier.id as ConversationMessageId, me)
    expect(versions.map((v) => v.content)).toEqual(['Happy to help!', 'Happy to help'])
    expect(versions[0]?.editorName).toBe('Ava Agent')

    await expect(
      listConversationMessageEdits(earlier.id as ConversationMessageId, actorFor(visitor))
    ).rejects.toThrow(NotFoundError)
  })
})
