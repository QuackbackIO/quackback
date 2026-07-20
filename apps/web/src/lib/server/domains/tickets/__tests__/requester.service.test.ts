/**
 * Real-DB coverage for the requester-facing ticket service (§4.2, 7C): ownership
 * gating (a requester only ever reaches their own customer tickets), the
 * internal-note strip on the requester thread, and the visitor-authored requester
 * reply. Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type UserId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// config getters validate the full env (absent in tests); provide just what the
// attachment URL check (validateAttachments -> isTrustedAttachmentUrl) reads.
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

// Neutralize the real Redis-backed realtime publish (unified inbox §3.2, M3):
// replyToMyTicket/createMyTicket now fire it too (via insertTicketMessage /
// createTicketCore), and this suite isn't exercising that behavior. The
// conversation-channel spies cover the Phase 2 read-through delegation
// (markMyTicketRead → the conversation domain's mark-read).
const realtime = vi.hoisted(() => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

// Spy the fire-and-forget `ticket.replied` dispatch so the append-core tests can
// assert it fires without running the real event pipeline. Spread keeps every
// other webhook export (e.g. createTicketCore's emit) real.
const emitTicketReplied = vi.hoisted(() => vi.fn())
vi.mock('../ticket.webhooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ticket.webhooks')>()),
  emitTicketReplied,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  ticketConversations,
  tickets,
  ticketStatuses,
  ticketSubscriptions,
  companies,
  principal,
  user,
  settings,
  eq,
  and,
  isNull,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import {
  listMyTickets,
  getMyTicket,
  getMyTicketThread,
  replyToMyTicket,
  createMyTicket,
  appendInboundTicketReply,
  captureRequesterEmail,
  requesterHasContactChannel,
  markMyTicketRead,
} from '../requester.service'
import { sendTicketMessage, addTicketNote } from '../ticket-message.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

function requesterActor(principalId: PrincipalId): Actor {
  return { ...ANONYMOUS_ACTOR, principalId, principalType: 'user' }
}

/** A widget visitor: a real principal but an anonymous-tier actor (the tier the
 *  email-capture guard gates on). */
function anonymousActor(principalId: PrincipalId): Actor {
  return { ...ANONYMOUS_ACTOR, principalId, principalType: 'anonymous' }
}

/** Seed a workspace + a single default status the create path resolves to. */
async function seedDefaultStatusWorld(): Promise<PrincipalId> {
  await testDb
    .insert(settings)
    .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  await testDb
    .insert(ticketStatuses)
    .values({ name: 'New', slug: `def_${suffix()}`, isDefault: true })
  return seedPrincipal()
}

/** An agent actor with reply/note perms, to seed thread messages on a ticket. */
function agentActor(principalId: PrincipalId): Actor {
  return {
    ...ANONYMOUS_ACTOR,
    principalId,
    principalType: 'user',
    permissions: new Set<PermissionKey>([PERMISSIONS.TICKET_REPLY, PERMISSIONS.TICKET_NOTE]),
  }
}

async function seedWorld() {
  await testDb
    .insert(settings)
    .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
  const me = await seedPrincipal()
  const other = await seedPrincipal()
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `s_${suffix()}` })
  const mine = createId('ticket') as TicketId
  const theirs = createId('ticket') as TicketId
  const myBackOffice = createId('ticket') as TicketId
  await testDb.insert(tickets).values([
    { id: mine, title: 'Mine', statusId, type: 'customer', requesterPrincipalId: me },
    { id: theirs, title: 'Theirs', statusId, type: 'customer', requesterPrincipalId: other },
    {
      id: myBackOffice,
      title: 'Internal',
      statusId,
      type: 'back_office',
      requesterPrincipalId: me,
    },
  ])
  return { me, other, mine, theirs, myBackOffice }
}

/** A first-open + an awaiting-requester + a closed status, for reopen tests. */
async function seedStagedStatuses() {
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  // Soft-delete every committed OPEN status so the seeded first-open is the
  // reopen's only possible landing (the reopen query filters deletedAt);
  // without this a committed status can outrank it on position.
  await testDb
    .update(ticketStatuses)
    .set({ deletedAt: new Date() })
    .where(and(eq(ticketStatuses.category, 'open'), isNull(ticketStatuses.deletedAt)))
  const [firstOpen] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'New',
      slug: `open_${suffix()}`,
      category: 'open',
      position: 0,
      isDefault: true,
      publicStage: 'received',
    })
    .returning()
  const [awaiting] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'Waiting',
      slug: `wait_${suffix()}`,
      category: 'pending',
      position: 5,
      publicStage: 'awaiting_requester',
    })
    .returning()
  const [closed] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'Done',
      slug: `closed_${suffix()}`,
      category: 'closed',
      position: 9,
      publicStage: 'resolved',
    })
    .returning()
  return { firstOpen, awaiting, closed }
}

async function readTicketRow(id: TicketId) {
  const [row] = await testDb.select().from(tickets).where(eq(tickets.id, id)).limit(1)
  return row
}

/** The category of the ticket's current status (the reopen may land on any of
 *  several seeded/committed open statuses, so tests assert the category). */
async function currentStatusCategory(ticketId: TicketId): Promise<string> {
  const row = await readTicketRow(ticketId)
  const [status] = await testDb
    .select({ category: ticketStatuses.category })
    .from(ticketStatuses)
    .where(eq(ticketStatuses.id, row.statusId))
  return status.category
}

describe.skipIf(!fixture.available)('requester ticket service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('listMyTickets returns only my customer tickets', async () => {
    const w = await seedWorld()
    const ids = (await listMyTickets(requesterActor(w.me))).map((d) => d.id)
    expect(ids).toContain(w.mine)
    expect(ids).not.toContain(w.theirs) // another requester's
    expect(ids).not.toContain(w.myBackOffice) // not a customer ticket
  })

  it('listMyTickets carries the Phase 2 unread badge — a linked pair reads the conversation watermark', async () => {
    const w = await seedWorld()
    const agent = await seedPrincipal()
    // Pair my ticket with a conversation and put an agent reply on the SHARED
    // thread (post-1a writes land conversation-parented; seeded directly).
    const conversationId = createId('conversation') as ConversationId
    await testDb
      .insert(conversations)
      .values({ id: conversationId, visitorPrincipalId: w.me, channel: 'messenger' })
    await testDb
      .insert(ticketConversations)
      .values({ ticketId: w.mine, conversationId, ticketType: 'customer' })
    await testDb.insert(conversationMessages).values({
      conversationId,
      principalId: agent,
      senderType: 'agent',
      content: 'on it',
    })
    // A legacy ticket-parented agent row on the PAIR no longer counts (the
    // accepted cutover glitch — the conversation watermark is the pair truth).
    await testDb.insert(conversationMessages).values({
      ticketId: w.mine,
      principalId: agent,
      senderType: 'agent',
      content: 'legacy',
    })
    // A standalone ticket of mine with a legacy agent reply — still counts.
    const standalone = createId('ticket') as TicketId
    const mineRow = await readTicketRow(w.mine)
    await testDb.insert(tickets).values({
      id: standalone,
      title: 'Alone',
      statusId: mineRow.statusId,
      type: 'customer',
      requesterPrincipalId: w.me,
    })
    await testDb.insert(conversationMessages).values({
      ticketId: standalone,
      principalId: agent,
      senderType: 'agent',
      content: 'legacy agent reply',
    })

    const list = await listMyTickets(requesterActor(w.me))
    expect(list.find((t) => t.id === w.mine)?.unreadCount).toBe(1)
    expect(list.find((t) => t.id === standalone)?.unreadCount).toBe(1)
  })

  it('markMyTicketRead marks the pair shared watermark read (read-through), ownership-gated', async () => {
    const w = await seedWorld()
    const conversationId = createId('conversation') as ConversationId
    await testDb
      .insert(conversations)
      .values({ id: conversationId, visitorPrincipalId: w.me, channel: 'messenger' })
    await testDb
      .insert(ticketConversations)
      .values({ ticketId: w.mine, conversationId, ticketType: 'customer' })

    // Another requester can never mark my ticket read (existence hidden).
    await expect(markMyTicketRead(requesterActor(w.other), w.mine)).rejects.toThrow(/not found/i)

    await markMyTicketRead(requesterActor(w.me), w.mine)

    // The CONVERSATION's visitor watermark moved (the Messages space reads
    // it); the legacy ticket columns stayed untouched.
    const [conv] = await testDb
      .select({ visitorLastReadAt: conversations.visitorLastReadAt })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect(conv.visitorLastReadAt).not.toBeNull()
    const ticketRow = await readTicketRow(w.mine)
    expect(ticketRow.requesterLastReadAt).toBeNull()
    expect(ticketRow.assigneeLastReadAt).toBeNull()
  })

  it("getMyTicket 404s another requester's ticket", async () => {
    const w = await seedWorld()
    await expect(getMyTicket(requesterActor(w.me), w.theirs)).rejects.toThrow(/not found/i)
  })

  it('getMyTicket 404s a non-customer ticket even when I am the requester', async () => {
    const w = await seedWorld()
    await expect(getMyTicket(requesterActor(w.me), w.myBackOffice)).rejects.toThrow(/not found/i)
  })

  it('getMyTicketThread strips internal notes', async () => {
    const w = await seedWorld()
    const agent = agentActor(w.other)
    await sendTicketMessage(agent, { ticketId: w.mine, content: 'public reply' })
    await addTicketNote(agent, { ticketId: w.mine, content: 'internal note' })
    const page = await getMyTicketThread(requesterActor(w.me), w.mine)
    expect(page.messages.map((m) => m.content)).toEqual(['public reply'])
  })

  it('replyToMyTicket posts a visitor message on my ticket', async () => {
    const w = await seedWorld()
    const { message } = await replyToMyTicket(requesterActor(w.me), {
      ticketId: w.mine,
      content: 'thanks!',
    })
    expect(message.senderType).toBe('visitor')
    expect(message.ticketId).toBe(w.mine)
  })

  it('replyToMyTicket publishes a ticket_message realtime event (unified inbox §3.2, M3)', async () => {
    const w = await seedWorld()
    realtime.publishTicketEvent.mockClear()
    const { message } = await replyToMyTicket(requesterActor(w.me), {
      ticketId: w.mine,
      content: 'thanks!',
    })
    expect(realtime.publishTicketEvent).toHaveBeenCalledWith(w.mine, {
      kind: 'ticket_message',
      ticketId: w.mine,
      message,
    })
  })

  it("replyToMyTicket 404s another requester's ticket", async () => {
    const w = await seedWorld()
    await expect(
      replyToMyTicket(requesterActor(w.me), { ticketId: w.theirs, content: 'sneaky' })
    ).rejects.toThrow(/not found/i)
  })

  it('replyToMyTicket persists contentJson + attachments (wire shape for the portal rich composer)', async () => {
    const w = await seedWorld()
    const contentJson = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Still broken, see attached.' }] },
      ],
    }
    const attachments = [
      {
        url: '/api/storage/chat-images/screenshot.png',
        name: 'screenshot.png',
        contentType: 'image/png',
        size: 2048,
      },
    ]
    const { message } = await replyToMyTicket(requesterActor(w.me), {
      ticketId: w.mine,
      content: 'Still broken, see attached.',
      contentJson,
      attachments,
    })
    expect(message.contentJson?.content?.[0]?.type).toBe('paragraph')
    expect(message.attachments).toHaveLength(1)
    expect(message.attachments[0]).toMatchObject({
      url: '/api/storage/chat-images/screenshot.png',
      name: 'screenshot.png',
    })

    // Re-read through the requester thread to prove it round-trips off the DB,
    // not just off the write's in-memory return value.
    const page = await getMyTicketThread(requesterActor(w.me), w.mine)
    const stored = page.messages.find((m) => m.id === message.id)
    expect(stored?.contentJson?.content?.[0]?.type).toBe('paragraph')
    expect(stored?.attachments).toHaveLength(1)
  })

  it('replyToMyTicket clears an external inline-image src (visitor images are trusted-origin only)', async () => {
    const w = await seedWorld()
    const contentJson = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'look at this' }] },
        {
          type: 'resizableImage',
          attrs: { src: 'https://evil.example.com/track.gif', alt: 'x' },
        },
        {
          type: 'resizableImage',
          attrs: { src: '/api/storage/portal-images/mine.png', alt: 'ok' },
        },
      ],
    }
    const { message } = await replyToMyTicket(requesterActor(w.me), {
      ticketId: w.mine,
      content: 'look at this',
      contentJson,
    })
    const images = (message.contentJson?.content ?? []).filter((n) => n.type === 'resizableImage')
    // External host neutralized; own-storage src kept.
    expect(images[0]?.attrs?.src).toBe('')
    expect(images[1]?.attrs?.src).toBe('/api/storage/portal-images/mine.png')
  })

  it('createMyTicket opens a customer ticket owned by me with a visitor opening message', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
    // A single default status the creation resolves to.
    await testDb
      .update(ticketStatuses)
      .set({ isDefault: false })
      .where(eq(ticketStatuses.isDefault, true))
    await testDb
      .insert(ticketStatuses)
      .values({ name: 'New', slug: `def_${suffix()}`, isDefault: true })
    const me = await seedPrincipal()

    const dto = await createMyTicket(requesterActor(me), {
      title: 'Broken',
      description: 'It really broke',
    })
    expect(dto.type).toBe('customer')
    expect(dto.requester?.principalId).toBe(me)

    const page = await getMyTicketThread(requesterActor(me), dto.id)
    expect(page.messages.map((m) => m.senderType)).toEqual(['visitor'])
    expect(page.messages[0].content).toBe('It really broke')
  })

  it('createMyTicket seeds descriptionJson + attachments on the opening message', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
    await testDb
      .update(ticketStatuses)
      .set({ isDefault: false })
      .where(eq(ticketStatuses.isDefault, true))
    await testDb
      .insert(ticketStatuses)
      .values({ name: 'New', slug: `def_${suffix()}`, isDefault: true })
    const me = await seedPrincipal()

    const descriptionJson = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich description.' }] }],
    }
    const attachments = [
      {
        url: '/api/storage/chat-images/attached.png',
        name: 'attached.png',
        contentType: 'image/png',
        size: 512,
      },
    ]
    const dto = await createMyTicket(requesterActor(me), {
      title: 'Broken, with a screenshot',
      descriptionJson,
      attachments,
    })

    const page = await getMyTicketThread(requesterActor(me), dto.id)
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].content).toBe('Rich description.')
    expect(page.messages[0].contentJson?.content?.[0]?.type).toBe('paragraph')
    expect(page.messages[0].attachments).toHaveLength(1)
  })

  it('createMyTicket persists customAttributes, readable via getMyTicket', async () => {
    const me = await seedDefaultStatusWorld()
    const dto = await createMyTicket(requesterActor(me), {
      title: 'Broken',
      customAttributes: { severity: 'high', count: 3 },
    })
    const read = await getMyTicket(requesterActor(me), dto.id)
    expect(read.customAttributes.severity).toBe('high')
    expect(read.customAttributes.count).toBe(3)
  })

  it('createMyTicket without customAttributes stores an empty object (unchanged behavior)', async () => {
    const me = await seedDefaultStatusWorld()
    const dto = await createMyTicket(requesterActor(me), { title: 'Plain' })
    const read = await getMyTicket(requesterActor(me), dto.id)
    expect(read.customAttributes).toEqual({})
  })

  it('refuses an anonymous requester with no contact email (EMAIL_REQUIRED)', async () => {
    const me = await seedDefaultStatusWorld()
    expect(await requesterHasContactChannel(anonymousActor(me))).toBe(false)
    await expect(createMyTicket(anonymousActor(me), { title: 'X' })).rejects.toThrow(/email/i)
  })

  it('captureRequesterEmail (overwrite-once) unlocks create for an anonymous requester', async () => {
    const me = await seedDefaultStatusWorld()
    const first = await captureRequesterEmail(me, 'Visitor@Example.com')
    expect(first.captured).toBe(true)
    // Normalized + on file now.
    expect(await requesterHasContactChannel(anonymousActor(me))).toBe(true)
    // A second capture never overwrites the address already on file.
    const second = await captureRequesterEmail(me, 'other@example.com')
    expect(second.captured).toBe(false)
    const dto = await createMyTicket(anonymousActor(me), { title: 'X' })
    expect(dto.type).toBe('customer')
  })

  it('a verified (user) requester never needs a captured email', async () => {
    const me = await seedDefaultStatusWorld()
    expect(await requesterHasContactChannel(requesterActor(me))).toBe(true)
    const dto = await createMyTicket(requesterActor(me), { title: 'X' })
    expect(dto.type).toBe('customer')
  })

  it('a requester reply reopens an awaiting-requester ticket to the first open status', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id: ticketId,
      title: 'T',
      statusId: s.awaiting.id,
      type: 'customer',
      requesterPrincipalId: me,
    })
    await replyToMyTicket(requesterActor(me), { ticketId, content: 'still broken' })
    expect(await currentStatusCategory(ticketId)).toBe('open')
  })

  it('a requester reply reopens a closed ticket, clearing resolvedAt + counting the reopen', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id: ticketId,
      title: 'T',
      statusId: s.closed.id,
      type: 'customer',
      requesterPrincipalId: me,
      resolvedAt: new Date(),
    })
    await replyToMyTicket(requesterActor(me), { ticketId, content: 'reopen please' })
    const row = await readTicketRow(ticketId)
    expect(await currentStatusCategory(ticketId)).toBe('open')
    expect(row.resolvedAt).toBeNull()
    expect(row.reopenedCount).toBe(1)
  })

  // The reply-by-email ingest core: same visitor-message + auto-reopen + emit
  // semantics as `replyToMyTicket`, but the caller (the inbound email pipeline)
  // has already verified ownership, so it takes the resolved requester id directly.
  it('appendInboundTicketReply posts a visitor reply, reopens a closed ticket, and emits ticket.replied', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id: ticketId,
      title: 'T',
      statusId: s.closed.id,
      type: 'customer',
      requesterPrincipalId: me,
      resolvedAt: new Date(),
    })
    emitTicketReplied.mockClear()

    const { message } = await appendInboundTicketReply(
      ticketId,
      me,
      { content: 'Yes, still broken.', metadata: { source: 'email', emailMessageId: '<m@x>' } },
      'user'
    )

    expect(message.senderType).toBe('visitor')
    expect(message.ticketId).toBe(ticketId)
    // Auto-reopen fired: a closed ticket moves to open, clears resolvedAt, counts it.
    const row = await readTicketRow(ticketId)
    expect(await currentStatusCategory(ticketId)).toBe('open')
    expect(row.resolvedAt).toBeNull()
    expect(row.reopenedCount).toBe(1)
    // ticket.replied fired with the requester as the event actor + the visitor message.
    expect(emitTicketReplied).toHaveBeenCalledTimes(1)
    const [actorArg, , messageArg] = emitTicketReplied.mock.calls[0]
    expect((actorArg as Actor).principalId).toBe(me)
    expect((messageArg as { senderType: string }).senderType).toBe('visitor')
  })

  it('a requester reply on an already-open ticket does not change its status', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id: ticketId,
      title: 'T',
      statusId: s.firstOpen.id,
      type: 'customer',
      requesterPrincipalId: me,
    })
    await replyToMyTicket(requesterActor(me), { ticketId, content: 'thanks' })
    expect((await readTicketRow(ticketId)).statusId).toBe(s.firstOpen.id)
  })

  it('requester DTOs strip the internal status and the SLA sliver', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
    const me = await seedPrincipal()
    const statusId = createId('ticket_status') as TicketStatusId
    await testDb
      .insert(ticketStatuses)
      .values({ id: statusId, name: 'Escalated', slug: `esc_${suffix()}` })
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id: ticketId,
      title: 'T',
      statusId,
      type: 'customer',
      requesterPrincipalId: me,
      slaApplied: {
        policyId: 'sla_policy_x',
        policyName: 'Enterprise VIP',
        appliedAt: new Date().toISOString(),
        timeToResolveDueAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    })
    const listed = (await listMyTickets(requesterActor(me))).find((t) => t.id === ticketId)
    expect(listed?.status).toBeNull()
    expect(listed?.sla).toBeNull()
    // The requester-facing projection (stage) survives the strip.
    expect(listed?.stage).toBeDefined()
    const fetched = await getMyTicket(requesterActor(me), ticketId)
    expect(fetched.status).toBeNull()
    expect(fetched.sla).toBeNull()
  })

  it('createMyTicket returns the requester-audience DTO (no internal status/SLA)', async () => {
    await seedDefaultStatusWorld()
    const me = await seedPrincipal()
    const created = await createMyTicket(requesterActor(me), { title: 'New one' })
    expect(created.status).toBeNull()
    expect(created.sla).toBeNull()
  })

  it('createMyTicket stays unassigned and company-less, and subscribes only the requester', async () => {
    const me = await seedDefaultStatusWorld()
    // Give the requester a company: the requester intake must NOT propagate it
    // (company propagation is an agent-create default, see createTicket).
    const [company] = await testDb
      .insert(companies)
      .values({ name: `Acme-${suffix()}` })
      .returning()
    await testDb.update(principal).set({ companyId: company.id }).where(eq(principal.id, me))

    const dto = await createMyTicket(requesterActor(me), { title: 'Self-filed' })
    expect(dto.assignee.principalId).toBeNull()
    expect(dto.company).toBeNull()
    const rows = await testDb
      .select()
      .from(ticketSubscriptions)
      .where(eq(ticketSubscriptions.ticketId, dto.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ principalId: me, reason: 'requester' })
  })

  it('a requester reply that reopens a pending ticket resumes its paused TTR clock', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const ticketId = createId('ticket') as TicketId
    // Paused 2h ago with 1h of resolve clock left at the pause.
    const pausedAt = new Date(Date.now() - 2 * 3_600_000)
    const dueAt = new Date(Date.now() - 3_600_000)
    await testDb.insert(tickets).values({
      id: ticketId,
      title: 'T',
      statusId: s.awaiting.id,
      type: 'customer',
      requesterPrincipalId: me,
      slaApplied: {
        policyId: 'sla_policy_x',
        policyName: 'VIP',
        appliedAt: pausedAt.toISOString(),
        timeToResolveDueAt: dueAt.toISOString(),
        pauseOnPending: true,
        pausedAt: pausedAt.toISOString(),
      },
    })
    await replyToMyTicket(requesterActor(me), { ticketId, content: 'here is the info' })
    expect(await currentStatusCategory(ticketId)).toBe('open')
    // The reopen emits ticket.status_changed like any other status move, so
    // the resume rides that event's SLA hook (fire-and-forget through the
    // dispatch pipeline) rather than a direct call inside the reopen — wait
    // for the hook to land: pausedAt cleared, deadline shifted forward by the
    // paused span.
    await vi.waitFor(
      async () => {
        const stamp = (await readTicketRow(ticketId)).slaApplied as {
          pausedAt?: string | null
        }
        expect(stamp.pausedAt ?? null).toBeNull()
      },
      { timeout: 5000 }
    )
    const stamp = (await readTicketRow(ticketId)).slaApplied as {
      pausedAt?: string | null
      timeToResolveDueAt: string
    }
    const expected = dueAt.getTime() + (Date.now() - pausedAt.getTime())
    expect(Math.abs(new Date(stamp.timeToResolveDueAt).getTime() - expected)).toBeLessThan(60_000)
  })

  it('a requester reply that reopens an awaiting ticket posts the customer-visible stage event', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id: ticketId,
      title: 'T',
      statusId: s.awaiting.id,
      type: 'customer',
      requesterPrincipalId: me,
    })
    await replyToMyTicket(requesterActor(me), { ticketId, content: 'still broken' })
    // Mirroring setTicketStatus, the reopen's stage crossing (awaiting_requester
    // -> received) posts a status event into the requester-visible thread.
    const page = await getMyTicketThread(requesterActor(me), ticketId)
    const event = page.messages.find((m) => m.systemEvent?.kind === 'ticket_status_changed')
    expect(event).toBeDefined()
    expect(event?.senderType).toBe('system')
  })
})
