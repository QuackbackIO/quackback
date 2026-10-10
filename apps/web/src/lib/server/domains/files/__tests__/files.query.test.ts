/**
 * Real-DB coverage for the Files sidebar read: attachments across a
 * conversation or ticket's whole thread, newest first, with internal notes
 * included (agent-only surface) and a hard cap.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessages,
  conversations,
  tickets,
  ticketStatuses,
  principal,
  user,
  files,
} from '@/lib/server/db'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// attachmentForClient re-signs URLs through the storage config, which isn't
// set up in this test environment; stub it to the identity it falls back to
// in production when a workspace's storage credentials don't resolve.
vi.mock('@/lib/server/storage/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/storage/s3')>()),
  resignStoredAssetUrl: (src: string) => src,
  getPublicUrlOrNull: (key: string | null | undefined) => key ?? null,
}))

import { listConversationFiles } from '../files.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
    await db.select({ id: files.id }).from(files).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

function att(name: string): ConversationAttachment {
  return { url: `/api/storage/files/${name}`, name, contentType: 'application/pdf', size: 10 }
}

async function seedVisitor(): Promise<PrincipalId> {
  const [p] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  return p!.id
}

async function seedTeamMember(name: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

async function seedConversation(visitor: PrincipalId) {
  const [c] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor, channel: 'messenger' })
    .returning()
  return c!
}

async function seedTicket() {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({
      name: `Files-Open-${suffix()}`,
      slug: `files_open_${suffix()}`,
      category: 'open',
      position: 300,
    })
    .returning()
  const [t] = await testDb
    .insert(tickets)
    .values({ type: 'customer', title: `Files ticket ${suffix()}`, statusId: status!.id })
    .returning()
  return t!
}

async function insertMessage(opts: {
  conversationId?: string
  ticketId?: string
  principalId: PrincipalId
  senderType: 'visitor' | 'agent'
  attachments?: ConversationAttachment[]
  isInternal?: boolean
  createdAt: Date
}) {
  const [m] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId: opts.conversationId as never,
      ticketId: opts.ticketId as never,
      principalId: opts.principalId,
      senderType: opts.senderType,
      content: 'hi',
      attachments: opts.attachments ?? null,
      isInternal: opts.isInternal ?? false,
      createdAt: opts.createdAt,
    })
    .returning()
  return m!
}

describe.skipIf(!fixture.available)('listConversationFiles (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('reads only the named conversation, newest message first, in attachment order within a message', async () => {
    const visitor = await seedVisitor()
    const convA = await seedConversation(visitor)
    const convB = await seedConversation(visitor)

    await insertMessage({
      conversationId: convA.id,
      principalId: visitor,
      senderType: 'visitor',
      attachments: [att('a1.pdf'), att('a2.pdf')],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    await insertMessage({
      conversationId: convA.id,
      principalId: visitor,
      senderType: 'visitor',
      attachments: [att('a3.pdf')],
      createdAt: new Date('2026-01-01T01:00:00Z'),
    })
    // A message with no attachments contributes nothing.
    await insertMessage({
      conversationId: convA.id,
      principalId: visitor,
      senderType: 'visitor',
      createdAt: new Date('2026-01-01T02:00:00Z'),
    })
    // Another conversation's files never leak in.
    await insertMessage({
      conversationId: convB.id,
      principalId: visitor,
      senderType: 'visitor',
      attachments: [att('other.pdf')],
      createdAt: new Date('2026-01-01T03:00:00Z'),
    })

    const result = await listConversationFiles({ conversationId: convA.id })
    expect(result.map((r) => r.attachment.name)).toEqual(['a3.pdf', 'a1.pdf', 'a2.pdf'])
  })

  it('includes internal notes for a ticket thread and resolves the sender name', async () => {
    const agent = await seedTeamMember('Priya Kapoor')
    const ticket = await seedTicket()

    await insertMessage({
      ticketId: ticket.id,
      principalId: agent,
      senderType: 'agent',
      isInternal: true,
      attachments: [att('secret.pdf')],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    await insertMessage({
      ticketId: ticket.id,
      principalId: agent,
      senderType: 'agent',
      attachments: [att('public.pdf')],
      createdAt: new Date('2026-01-01T01:00:00Z'),
    })

    const result = await listConversationFiles({ ticketId: ticket.id })
    expect(result.map((r) => r.attachment.name)).toEqual(['public.pdf', 'secret.pdf'])
    expect(result.every((r) => r.senderName === 'Priya Kapoor')).toBe(true)
    expect(result.every((r) => r.messageId)).toBeTruthy()
  })

  it('caps the result at 200 attachments', async () => {
    const visitor = await seedVisitor()
    const conv = await seedConversation(visitor)
    const batch = (n: number) => Array.from({ length: 70 }, (_, i) => att(`m${n}-${i}.pdf`))

    await insertMessage({
      conversationId: conv.id,
      principalId: visitor,
      senderType: 'visitor',
      attachments: batch(1),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    await insertMessage({
      conversationId: conv.id,
      principalId: visitor,
      senderType: 'visitor',
      attachments: batch(2),
      createdAt: new Date('2026-01-01T01:00:00Z'),
    })
    await insertMessage({
      conversationId: conv.id,
      principalId: visitor,
      senderType: 'visitor',
      attachments: batch(3),
      createdAt: new Date('2026-01-01T02:00:00Z'),
    })

    const result = await listConversationFiles({ conversationId: conv.id })
    expect(result).toHaveLength(200)
    // Newest message's attachments lead the capped result.
    expect(result[0]!.attachment.name).toBe('m3-0.pdf')
  })
})
