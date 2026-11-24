/**
 * Deleting a message moves the inbox row's preview back to the newest
 * customer-visible message left (real DB, rolled back). Internal notes and
 * system lines never write the preview, so they never take it over; a thread
 * with no customer-visible message left shows no preview. The update reaches
 * open inboxes before the deletion event that makes them refetch.
 *
 * Real here: the writers and the rows they read and write. Stood in for:
 * realtime fan-out and the webhook and notification bridges.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId, ConversationMessageId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).configMocks()
)
vi.mock('@/lib/server/realtime/conversation-channels', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).channelMocks()
)
vi.mock('../conversation.webhooks', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).conversationWebhookMocks()
)
vi.mock('../conversation.notify', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).notifyMocks()
)
vi.mock('@/lib/server/domains/changelog/changelog-subscription.service', async () =>
  (
    await import('@/lib/server/__tests__/conversation-visibility-mocks')
  ).changelogSubscriptionMocks()
)
vi.mock('@/lib/server/domains/channels', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).channelAdapterMocks()
)
vi.mock('@/lib/server/domains/conversation-attributes/ai-classification.service', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).attributeClassifierMocks()
)
vi.mock('@/lib/server/events/dispatch', async (importOriginal) =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).eventDispatchMocks(
    await importOriginal<typeof import('@/lib/server/events/dispatch')>()
  )
)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { seedWorld, workspaceKey } from '@/lib/server/__tests__/conversation-visibility-world'
import { conversationMessages, conversations, eq } from '@/lib/server/db'
import {
  publishConversationEvent,
  publishConversationUpdate,
} from '@/lib/server/realtime/conversation-channels'
import { addAgentNote, deleteConversationMessage, sendAgentMessage } from '../conversation.service'

const fixture = await createDbTestFixture()

async function previewOf(id: ConversationId): Promise<string | null> {
  const [row] = await testDb
    .select({ preview: conversations.lastMessagePreview })
    .from(conversations)
    .where(eq(conversations.id, id))
  return row.preview
}

describe('the inbox preview after a message is deleted (real DB, rolled back)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('falls back to the newest customer-visible message, past notes and system lines', async () => {
    const w = await seedWorld()
    const { id } = await w.conversation(w.teamX)
    await sendAgentMessage(id, 'First answer', w.author, workspaceKey)
    const second = await sendAgentMessage(id, 'Second answer', w.author, workspaceKey)
    // Written after the reply, neither one is what the customer last saw.
    await addAgentNote(id, 'Internal: refund approved', w.author, workspaceKey)
    await testDb
      .insert(conversationMessages)
      .values({ conversationId: id, senderType: 'system', content: 'Ana closed the chat' })
    expect(await previewOf(id)).toBe('Second answer')
    vi.clearAllMocks()

    await deleteConversationMessage(second.message.id as ConversationMessageId, workspaceKey)

    expect(await previewOf(id)).toBe('First answer')
    // Open inboxes get the new preview, before the deletion that refetches them.
    const update = vi.mocked(publishConversationUpdate)
    expect(update).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ lastMessagePreview: 'First answer' })
    )
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(publishConversationEvent).mock.invocationCallOrder[0]
    )
  })

  it('shows no preview once no customer-visible message is left', async () => {
    const w = await seedWorld()
    const { id, messageId } = await w.conversation(w.teamX, {
      lastMessagePreview: 'Acme cannot sign in',
    })
    await deleteConversationMessage(messageId, workspaceKey)
    expect(await previewOf(id)).toBeNull()
  })

  it('leaves the preview alone when an older message or a note is deleted', async () => {
    const w = await seedWorld()
    const { id, messageId } = await w.conversation(w.teamX)
    await sendAgentMessage(id, 'Newest answer', w.author, workspaceKey)
    const note = await addAgentNote(id, 'Internal only', w.author, workspaceKey)
    vi.clearAllMocks()

    await deleteConversationMessage(messageId, workspaceKey)
    await deleteConversationMessage(note.message.id as ConversationMessageId, workspaceKey)

    expect(await previewOf(id)).toBe('Newest answer')
    expect(publishConversationUpdate).not.toHaveBeenCalled()
  })
})
