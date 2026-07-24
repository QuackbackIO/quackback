/**
 * Real-DB coverage for the requester-facing ticket service on the converged
 * Messages surface: the reply-by-email ingest core (`appendInboundTicketReply`
 * — the ONLY requester write left in this module; in-app replies ride the
 * conversation send path) and the ownership-gated watch bell. The linked-
 * ticket header/list reads live in requester-conversation-ticket.test.ts.
 * Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
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

// config getters validate the full env (absent in tests); provide just what the
// attachment URL check (validateAttachments -> isTrustedAttachmentUrl) reads.
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

// Neutralize the real Redis-backed realtime publish: the ingest core fires it
// via insertTicketMessage, and this suite isn't exercising the transport.
const realtime = vi.hoisted(() => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

// Spy the fire-and-forget `ticket.replied` dispatch so the ingest tests can
// assert it fires without running the real event pipeline. Spread keeps every
// other webhook export real.
const emitTicketReplied = vi.hoisted(() => vi.fn())
vi.mock('../ticket.webhooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ticket.webhooks')>()),
  emitTicketReplied,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessages,
  tickets,
  ticketStatuses,
  ticketSubscriptions,
  principal,
  user,
  settings,
  eq,
  and,
  isNull,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import {
  appendInboundTicketReply,
  getMyTicketWatchStatus,
  watchMyTicket,
  unwatchMyTicket,
} from '../requester.service'

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

async function seedWorkspace(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
}

async function seedTicket(input: {
  requester: PrincipalId
  statusId: TicketStatusId
  resolvedAt?: Date
}): Promise<TicketId> {
  const ticketId = createId('ticket') as TicketId
  await testDb.insert(tickets).values({
    id: ticketId,
    title: 'T',
    statusId: input.statusId,
    type: 'customer',
    requesterPrincipalId: input.requester,
    resolvedAt: input.resolvedAt ?? null,
  })
  return ticketId
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

  it('appendInboundTicketReply posts a visitor reply, reopens a closed ticket, and emits ticket.replied', async () => {
    await seedWorkspace()
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const ticketId = await seedTicket({
      requester: me,
      statusId: s.closed.id,
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

  it('reopens an awaiting-requester ticket to the first open status; an already-open ticket is untouched', async () => {
    await seedWorkspace()
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()

    const awaiting = await seedTicket({ requester: me, statusId: s.awaiting.id })
    await appendInboundTicketReply(awaiting, me, { content: 'still broken' })
    expect(await currentStatusCategory(awaiting)).toBe('open')

    const open = await seedTicket({ requester: me, statusId: s.firstOpen.id })
    await appendInboundTicketReply(open, me, { content: 'thanks' })
    expect((await readTicketRow(open)).statusId).toBe(s.firstOpen.id)
  })

  it('B18: a reply re-subscribes the requester, but an existing (muted) row is untouched — a mute still wins', async () => {
    await seedWorkspace()
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()

    // No subscription row (the "Stop watching" state) → the reply recreates it.
    const unwatched = await seedTicket({ requester: me, statusId: s.firstOpen.id })
    await appendInboundTicketReply(unwatched, me, { content: 'following up' })
    const created = await testDb
      .select()
      .from(ticketSubscriptions)
      .where(
        and(eq(ticketSubscriptions.ticketId, unwatched), eq(ticketSubscriptions.principalId, me))
      )
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ principalId: me, reason: 'requester' })

    // An existing muted row survives untouched.
    const muted = await seedTicket({ requester: me, statusId: s.firstOpen.id })
    const mutedUntil = new Date(Date.now() + 7 * 86_400_000)
    await testDb
      .insert(ticketSubscriptions)
      .values({ ticketId: muted, principalId: me, reason: 'requester', mutedUntil })
    await appendInboundTicketReply(muted, me, { content: 'one more thing' })
    const rows = await testDb
      .select()
      .from(ticketSubscriptions)
      .where(and(eq(ticketSubscriptions.ticketId, muted), eq(ticketSubscriptions.principalId, me)))
    expect(rows).toHaveLength(1)
    expect(rows[0].mutedUntil?.getTime()).toBe(mutedUntil.getTime())
  })

  it('publishes a ticket_message realtime event', async () => {
    await seedWorkspace()
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const ticketId = await seedTicket({ requester: me, statusId: s.firstOpen.id })
    realtime.publishTicketEvent.mockClear()
    const { message } = await appendInboundTicketReply(ticketId, me, { content: 'thanks!' })
    expect(realtime.publishTicketEvent).toHaveBeenCalledWith(ticketId, {
      kind: 'ticket_message',
      ticketId,
      message,
    })
  })

  it('persists contentJson + attachments and clears an external inline-image src', async () => {
    await seedWorkspace()
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const ticketId = await seedTicket({ requester: me, statusId: s.firstOpen.id })

    const contentJson = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'look at this' }] },
        { type: 'resizableImage', attrs: { src: 'https://evil.example.com/track.gif', alt: 'x' } },
        {
          type: 'resizableImage',
          attrs: { src: '/api/storage/portal-images/mine.png', alt: 'ok' },
        },
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
    const { message } = await appendInboundTicketReply(ticketId, me, {
      content: 'look at this',
      contentJson,
      attachments,
    })
    expect(message.attachments).toHaveLength(1)
    const images = (message.contentJson?.content ?? []).filter((n) => n.type === 'resizableImage')
    // External host neutralized; own-storage src kept (visitor images are
    // trusted-origin only).
    expect(images[0]?.attrs?.src).toBe('')
    expect(images[1]?.attrs?.src).toBe('/api/storage/portal-images/mine.png')
  })

  it('a reply that reopens a pending ticket resumes its paused TTR clock', async () => {
    await seedWorkspace()
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
    await appendInboundTicketReply(ticketId, me, { content: 'here is the info' })
    expect(await currentStatusCategory(ticketId)).toBe('open')
    // The reopen emits ticket.status_changed like any other status move, so
    // the resume rides that event's SLA hook (fire-and-forget through the
    // dispatch pipeline): pausedAt cleared, deadline shifted by the paused span.
    await vi.waitFor(
      async () => {
        const stamp = (await readTicketRow(ticketId)).slaApplied as { pausedAt?: string | null }
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

  it('a reply that reopens an awaiting ticket posts the customer-visible stage event', async () => {
    await seedWorkspace()
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const ticketId = await seedTicket({ requester: me, statusId: s.awaiting.id })
    await appendInboundTicketReply(ticketId, me, { content: 'still broken' })
    // Mirroring setTicketStatus, the reopen's stage crossing (awaiting_requester
    // -> received) posts a status event into the customer-visible thread.
    const rows = await testDb
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.ticketId, ticketId),
          eq(conversationMessages.senderType, 'system')
        )
      )
    const event = rows.find(
      (m) =>
        (m.metadata as { systemEvent?: { kind?: string } } | null)?.systemEvent?.kind ===
        'ticket_status_changed'
    )
    expect(event).toBeDefined()
  })

  it('watch bell is ownership-gated: another requester or a non-customer ticket 404s', async () => {
    await seedWorkspace()
    const s = await seedStagedStatuses()
    const me = await seedPrincipal()
    const other = await seedPrincipal()
    const mine = await seedTicket({ requester: me, statusId: s.firstOpen.id })
    const backOffice = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id: backOffice,
      title: 'Internal',
      statusId: s.firstOpen.id,
      type: 'back_office',
      requesterPrincipalId: me,
    })

    await expect(getMyTicketWatchStatus(requesterActor(other), mine)).rejects.toThrow(/not found/i)
    await expect(watchMyTicket(requesterActor(me), backOffice)).rejects.toThrow(/not found/i)

    await watchMyTicket(requesterActor(me), mine)
    expect((await getMyTicketWatchStatus(requesterActor(me), mine)).watching).toBe(true)
    await unwatchMyTicket(requesterActor(me), mine)
    expect((await getMyTicketWatchStatus(requesterActor(me), mine)).watching).toBe(false)
  })
})
