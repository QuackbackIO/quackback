/**
 * Real-DB coverage for the ticket thread message service (support platform §4.2,
 * wave 7C.1). Runs inside the db-test-fixture rollback transaction; the global
 * `db` is mocked to the fixture transaction so the service writes land in the
 * rolled-back tx. Asserts the agent-reply vs internal-note split, the
 * first_response_at stamp semantics, and the list ordering + internal gating.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type PrincipalId,
  type UserId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  conversationMessages,
  principal,
  user,
  eq,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { sendTicketMessage, addTicketNote, listTicketMessages } from '../ticket-message.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTicketWithAgent() {
  const userId = createId('user') as UserId
  const agentP = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `A-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: agentP, userId, role: 'member', type: 'user', createdAt: new Date() })

  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `tm-${suffix()}` })
  const ticketId = createId('ticket') as TicketId
  await testDb.insert(tickets).values({ id: ticketId, title: 'T', statusId })

  const actor: Actor = {
    ...ANONYMOUS_ACTOR,
    principalId: agentP,
    principalType: 'user',
    permissions: new Set<PermissionKey>([
      PERMISSIONS.TICKET_REPLY,
      PERMISSIONS.TICKET_NOTE,
      PERMISSIONS.TICKET_VIEW,
    ]),
  }
  return { ticketId, actor }
}

async function ticketFirstResponseAt(ticketId: TicketId): Promise<Date | null> {
  const [row] = await testDb
    .select({ at: tickets.firstResponseAt })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return row?.at ?? null
}

describe.skipIf(!fixture.available)('ticket message service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('an agent reply is a customer-visible ticket message that stamps first_response_at', async () => {
    const { ticketId, actor } = await seedTicketWithAgent()
    expect(await ticketFirstResponseAt(ticketId)).toBeNull()

    const { message } = await sendTicketMessage(actor, { ticketId, content: 'On it.' })

    expect(message.ticketId).toBe(ticketId)
    expect(message.conversationId).toBeNull()
    expect(message.isInternal).toBe(false)
    expect(message.senderType).toBe('agent')
    expect(await ticketFirstResponseAt(ticketId)).not.toBeNull()
  })

  it('first_response_at is stamped once, not on the second reply', async () => {
    const { ticketId, actor } = await seedTicketWithAgent()
    await sendTicketMessage(actor, { ticketId, content: 'first' })
    const first = await ticketFirstResponseAt(ticketId)
    await sendTicketMessage(actor, { ticketId, content: 'second' })
    expect(await ticketFirstResponseAt(ticketId)).toEqual(first)
  })

  it('an internal note is is_internal and does NOT stamp first_response_at', async () => {
    const { ticketId, actor } = await seedTicketWithAgent()
    const { message } = await addTicketNote(actor, { ticketId, content: 'internal only' })
    expect(message.isInternal).toBe(true)
    expect(await ticketFirstResponseAt(ticketId)).toBeNull()
  })

  it('lists messages oldest-first and hides internal notes when includeInternal is false', async () => {
    const { ticketId, actor } = await seedTicketWithAgent()
    await sendTicketMessage(actor, { ticketId, content: 'reply one' })
    await addTicketNote(actor, { ticketId, content: 'a note' })
    await sendTicketMessage(actor, { ticketId, content: 'reply two' })

    const agentView = await listTicketMessages(ticketId, { includeInternal: true })
    expect(agentView.messages.map((m) => m.content)).toEqual(['reply one', 'a note', 'reply two'])

    const customerView = await listTicketMessages(ticketId, { includeInternal: false })
    expect(customerView.messages.map((m) => m.content)).toEqual(['reply one', 'reply two'])
  })

  it('derives content from contentJson when a text-bearing doc arrives with blank content', async () => {
    const { ticketId, actor } = await seedTicketWithAgent()
    const contentJson = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line.' }] },
      ],
    }

    const { message } = await sendTicketMessage(actor, { ticketId, content: '', contentJson })

    expect(message.content).toBe('First line.\nSecond line.')
  })

  it('keeps the richMessageFallbackLabel behavior for an image-only doc with blank content', async () => {
    const { ticketId, actor } = await seedTicketWithAgent()
    const contentJson = {
      type: 'doc' as const,
      content: [{ type: 'chatImage', attrs: { src: null, alt: null } }],
    }

    const { message } = await sendTicketMessage(actor, { ticketId, content: '', contentJson })

    // No text leaf to derive from: richMessageFallbackLabel just clears
    // validateContent's empty-content guard (an image-only message is valid
    // with no text) — it was never a source for the stored `content`, so
    // that stays blank rather than being replaced with derived or label text.
    expect(message.content).toBe('')
    expect(message.contentJson?.content?.[0]?.type).toBe('chatImage')
  })

  it('extends the same image-only allowance to a resizableImage doc (the unified RichTextEditor node)', async () => {
    const { ticketId, actor } = await seedTicketWithAgent()
    const contentJson = {
      type: 'doc' as const,
      content: [{ type: 'resizableImage', attrs: { src: null, alt: null } }],
    }

    const { message } = await sendTicketMessage(actor, { ticketId, content: '', contentJson })

    expect(message.content).toBe('')
    expect(message.contentJson?.content?.[0]?.type).toBe('resizableImage')
  })

  it('keeps an external inline-image src on an AGENT reply (agents may paste external images)', async () => {
    const { ticketId, actor } = await seedTicketWithAgent()
    const contentJson = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'from the docs site:' }] },
        {
          type: 'resizableImage',
          attrs: { src: 'https://docs.example.com/diagram.png', alt: 'diagram' },
        },
      ],
    }

    const { message } = await sendTicketMessage(actor, {
      ticketId,
      content: 'from the docs site:',
      contentJson,
    })

    const img = (message.contentJson?.content ?? []).find((n) => n.type === 'resizableImage')
    expect(img?.attrs?.src).toBe('https://docs.example.com/diagram.png')
  })

  it('prefers explicit non-blank content over deriving from contentJson', async () => {
    const { ticketId, actor } = await seedTicketWithAgent()
    const contentJson = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Doc says this.' }] }],
    }

    const { message } = await sendTicketMessage(actor, {
      ticketId,
      content: 'Explicit content wins.',
      contentJson,
    })

    expect(message.content).toBe('Explicit content wins.')
  })
})
