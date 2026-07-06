/**
 * Real-DB coverage for the requester-facing ticket service (§4.2, 7C): ownership
 * gating (a requester only ever reaches their own customer tickets), the
 * internal-note strip on the requester thread, and the visitor-authored requester
 * reply. Runs inside the db-test-fixture rollback transaction.
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

// Neutralize the real Redis-backed realtime publish (unified inbox §3.2, M3):
// replyToMyTicket/createMyTicket now fire it too (via insertTicketMessage /
// createTicketCore), and this suite isn't exercising that behavior.
const realtime = vi.hoisted(() => ({ publishTicketEvent: vi.fn() }))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  principal,
  user,
  settings,
  eq,
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
})
