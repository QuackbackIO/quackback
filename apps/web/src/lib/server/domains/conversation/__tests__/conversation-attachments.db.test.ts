/**
 * Real-DB coverage for adding files to, and removing a file from, a sent
 * message (conversation.attachments.ts): the author rule shared with edits,
 * the file link and edit stamp, the cap, the stale-position guard, never
 * leaving a message empty, the ticket thread push, and the
 * ticket.attachment_added / _removed announcements (public replies only).
 * Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationMessageId,
  type FileId,
  type PrincipalId,
  type UserId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))
const realtime = vi.hoisted(() => ({
  publishTicketEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationOnlyEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)
const webhooks = vi.hoisted(() => ({
  emitTicketAttachmentChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/tickets/ticket.webhooks', () => webhooks)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  conversationMessages,
  files,
  principal,
  user,
  eq,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { addMessageAttachments, removeMessageAttachment } from '../conversation.attachments'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: files.id }).from(files).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedAgent(): Promise<Actor> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `A-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return {
    ...ANONYMOUS_ACTOR,
    principalId,
    role: 'member',
    principalType: 'user',
    permissions: new Set<PermissionKey>([
      PERMISSIONS.TICKET_REPLY,
      PERMISSIONS.TICKET_NOTE,
      PERMISSIONS.TICKET_VIEW,
    ]),
  }
}

async function seedTicketReply(
  author: Actor,
  over: Partial<typeof conversationMessages.$inferInsert> = {}
): Promise<{ ticketId: TicketId; messageId: ConversationMessageId }> {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `ma-${suffix()}` })
  const ticketId = createId('ticket') as TicketId
  // Assigned to the author: a scoped viewer sees their own tickets.
  await testDb
    .insert(tickets)
    .values({ id: ticketId, title: 'T', statusId, assigneePrincipalId: author.principalId })
  const messageId = createId('conversation_message') as ConversationMessageId
  await testDb.insert(conversationMessages).values({
    id: messageId,
    ticketId,
    senderType: 'agent',
    principalId: author.principalId,
    content: 'Here you go',
    isInternal: false,
    ...over,
  })
  return { ticketId, messageId }
}

async function seedFile(uploadedById: PrincipalId | null, name = `f-${suffix()}.pdf`) {
  const [row] = await testDb
    .insert(files)
    .values({
      storageKey: `files/2026/10/${createId('file')}.pdf`,
      name,
      contentType: 'application/pdf',
      family: 'pdf',
      size: 10,
      sha256: 'a'.repeat(64),
      source: 'agent',
      uploadedById,
    })
    .returning()
  return row!
}

const ref = (f: { id: FileId; name: string }) => ({
  url: `/api/storage/${f.id}`,
  name: f.name,
  contentType: 'application/pdf',
  size: 10,
  fileId: f.id,
})

async function messageRow(id: ConversationMessageId) {
  const [row] = await testDb
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, id))
  return row!
}

describe.skipIf(!fixture.available)('sent message files (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => {
    Object.values(realtime).forEach((m) => m.mockClear())
    webhooks.emitTicketAttachmentChanged.mockClear()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('adds files to a sent ticket reply, links them, stamps the edit and announces each file', async () => {
    const agent = await seedAgent()
    const { ticketId, messageId } = await seedTicketReply(agent)
    const a = await seedFile(agent.principalId)
    const b = await seedFile(agent.principalId)

    const dto = await addMessageAttachments(messageId, [ref(a), ref(b)], agent)

    expect(dto.attachments.map((x) => x.name)).toEqual([a.name, b.name])
    const row = await messageRow(messageId)
    expect(row.attachments?.map((x) => x.fileId)).toEqual([a.id, b.id])
    expect(row.editedAt).not.toBeNull()
    const [linked] = await testDb.select().from(files).where(eq(files.id, a.id))
    expect(linked.messageId).toBe(messageId)
    expect(linked.attachedAt).not.toBeNull()

    expect(realtime.publishTicketEvent).toHaveBeenCalledWith(
      ticketId,
      expect.objectContaining({ kind: 'ticket_message_updated', ticketId })
    )
    expect(webhooks.emitTicketAttachmentChanged).toHaveBeenCalledTimes(2)
    const [change, actor, announcedTicket, message, attachment] =
      webhooks.emitTicketAttachmentChanged.mock.calls[0]
    expect(change).toBe('added')
    expect(actor).toBe(agent)
    expect(announcedTicket).toBe(ticketId)
    expect(message.id).toBe(messageId)
    expect(attachment.fileId).toBe(a.id)
  })

  it('removes the named file at a position and announces it', async () => {
    const agent = await seedAgent()
    const a = await seedFile(agent.principalId)
    const b = await seedFile(agent.principalId)
    const { messageId } = await seedTicketReply(agent, { attachments: [ref(a), ref(b)] })

    const dto = await removeMessageAttachment(messageId, 0, a.name, agent)

    expect(dto.attachments.map((x) => x.name)).toEqual([b.name])
    expect((await messageRow(messageId)).attachments?.map((x) => x.fileId)).toEqual([b.id])
    const [change, , , , attachment] = webhooks.emitTicketAttachmentChanged.mock.calls[0]
    expect(change).toBe('removed')
    expect(attachment.fileId).toBe(a.id)
  })

  it('refuses a removal whose name no longer matches the file at that position', async () => {
    const agent = await seedAgent()
    const a = await seedFile(agent.principalId)
    const { messageId } = await seedTicketReply(agent, { attachments: [ref(a)] })

    await expect(removeMessageAttachment(messageId, 0, 'other.pdf', agent)).rejects.toThrow(
      /no longer on this message/i
    )
    await expect(removeMessageAttachment(messageId, 3, a.name, agent)).rejects.toThrow(
      /no longer on this message/i
    )
  })

  it('never leaves a message with neither text nor files', async () => {
    const agent = await seedAgent()
    const a = await seedFile(agent.principalId)
    const { messageId } = await seedTicketReply(agent, { content: '', attachments: [ref(a)] })

    await expect(removeMessageAttachment(messageId, 0, a.name, agent)).rejects.toThrow(
      /needs text or a file/i
    )
  })

  it("refuses changing someone else's message", async () => {
    const author = await seedAgent()
    const other = await seedAgent()
    const { messageId } = await seedTicketReply(author)
    const f = await seedFile(other.principalId)

    await expect(addMessageAttachments(messageId, [ref(f)], other)).rejects.toThrow()
    expect(webhooks.emitTicketAttachmentChanged).not.toHaveBeenCalled()
  })

  it('caps a message at the attachment limit', async () => {
    const agent = await seedAgent()
    const existing = await Promise.all(
      Array.from({ length: 10 }, () => seedFile(agent.principalId))
    )
    const { messageId } = await seedTicketReply(agent, { attachments: existing.map(ref) })
    const extra = await seedFile(agent.principalId)

    await expect(addMessageAttachments(messageId, [ref(extra)], agent)).rejects.toThrow(/at most/i)
  })

  it('changes an internal note without telling integrations', async () => {
    const agent = await seedAgent()
    const { ticketId, messageId } = await seedTicketReply(agent, { isInternal: true })
    const f = await seedFile(agent.principalId)

    await addMessageAttachments(messageId, [ref(f)], agent)

    expect(realtime.publishTicketEvent).toHaveBeenCalledWith(
      ticketId,
      expect.objectContaining({ kind: 'ticket_message_updated' })
    )
    expect(webhooks.emitTicketAttachmentChanged).not.toHaveBeenCalled()
  })
})
