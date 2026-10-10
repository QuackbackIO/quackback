/**
 * Test data in the inbox, the bulk delete and the 7-day retention sweep. A row
 * is test only when a test customer authored it: a teammate's own thread and
 * a legacy `test` attribute a client once wrote are real and must survive.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type ConversationId,
  type PostId,
  type PrincipalId,
  type TicketId,
  type UserId,
} from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  conversations,
  inArray,
  posts,
  principal,
  tickets,
  ticketConversations,
  ticketStatuses,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listConversationsForAgent } from '../conversation.query'
import { countInboxScopes } from '../../inbox/inbox.query'
import { deleteTestConversations, sweepTestData } from '../conversation.test-data'

const fixture = await createDbTestFixture()

const DAY = 86_400_000
let owner: PrincipalId, customer: PrincipalId, otherCustomer: PrincipalId, visitor: PrincipalId
let boardId: BoardId

function actorFor(id: PrincipalId): Actor {
  return { principalId: id, role: 'admin', principalType: 'user', segmentIds: new Set() }
}

async function seedConversation(
  by: PrincipalId,
  opts: { ageDays?: number; status?: 'open' | 'closed'; attrs?: Record<string, unknown> } = {}
) {
  const id = createId('conversation') as ConversationId
  const at = new Date(Date.now() - (opts.ageDays ?? 0) * DAY)
  await testDb.insert(conversations).values({
    id,
    visitorPrincipalId: by,
    channel: 'messenger',
    status: opts.status ?? 'open',
    customAttributes: opts.attrs ?? {},
    createdAt: at,
    lastMessageAt: at,
  })
  return id
}

async function seedPost(by: PrincipalId, ageDays = 0, meta: Record<string, string> | null = null) {
  const id = createId('post') as PostId
  await testDb.insert(posts).values({
    id,
    boardId,
    title: 'Dark mode',
    content: 'Please',
    principalId: by,
    widgetMetadata: meta,
    createdAt: new Date(Date.now() - ageDays * DAY),
  })
  return id
}

async function seedTicket(by: PrincipalId, ageDays = 0, attrs: Record<string, unknown> = {}) {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Acme open', slug: createId('ticket_status') })
    .returning()
  const id = createId('ticket') as TicketId
  await testDb.insert(tickets).values({
    id,
    title: 'Acme request',
    statusId: status.id,
    requesterPrincipalId: by,
    customAttributes: attrs,
    createdAt: new Date(Date.now() - ageDays * DAY),
  })
  return id
}

async function remainingConversations(ids: ConversationId[]) {
  const rows = await testDb
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.id, ids))
  return rows.map((r) => r.id).sort()
}

async function remainingPosts(ids: PostId[]) {
  const rows = await testDb.select({ id: posts.id }).from(posts).where(inArray(posts.id, ids))
  return rows.map((r) => r.id).sort()
}

async function remainingTickets(ids: TicketId[]) {
  const rows = await testDb.select({ id: tickets.id }).from(tickets).where(inArray(tickets.id, ids))
  return rows.map((r) => r.id).sort()
}

describe.skipIf(!fixture.available)('test data in the inbox and retention (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    owner = createId('principal') as PrincipalId
    const otherOwner = createId('principal') as PrincipalId
    customer = createId('principal') as PrincipalId
    otherCustomer = createId('principal') as PrincipalId
    visitor = createId('principal') as PrincipalId
    const [u1, u2] = [createId('user') as UserId, createId('user') as UserId]
    await testDb.insert(user).values([
      { id: u1, name: 'Acme' },
      { id: u2, name: 'Acme Two' },
    ])
    await testDb.insert(principal).values([
      { id: owner, userId: u1, role: 'admin', type: 'user', createdAt: new Date() },
      { id: otherOwner, userId: u2, role: 'admin', type: 'user', createdAt: new Date() },
      { id: visitor, role: 'user', type: 'anonymous', createdAt: new Date() },
    ])
    await testDb.insert(principal).values([
      {
        id: customer,
        role: 'user',
        type: 'anonymous',
        testOwnerPrincipalId: owner,
        createdAt: new Date(),
      },
      {
        id: otherCustomer,
        role: 'user',
        type: 'anonymous',
        testOwnerPrincipalId: otherOwner,
        createdAt: new Date(),
      },
    ])
    boardId = createId('board') as BoardId
    await testDb.insert(boards).values({ id: boardId, name: 'Feedback', slug: String(boardId) })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('flags only test-customer threads and lists only them in the Test view', async () => {
    const test = await seedConversation(customer)
    const teammate = await seedConversation(owner)
    const legacy = await seedConversation(visitor, { attrs: { test: true } })
    const listed = async (by: PrincipalId, testOnly = false) =>
      (await listConversationsForAgent({ visitorPrincipalId: by, testOnly }, actorFor(owner)))
        .conversations
    const flags = Object.fromEntries(
      [...(await listed(customer)), ...(await listed(owner)), ...(await listed(visitor))].map(
        (c) => [c.id, c.isTest]
      )
    )
    expect(flags).toEqual({ [test]: true, [teammate]: false, [legacy]: false })

    expect((await listed(customer, true)).map((c) => c.id)).toEqual([test])
    expect(await listed(owner, true)).toEqual([])
    expect(await listed(visitor, true)).toEqual([])
  })

  it('counts test threads in any status in Test, and never in the real badges', async () => {
    const before = await countInboxScopes(actorFor(owner))
    await testDb.insert(conversations).values({
      visitorPrincipalId: customer,
      channel: 'messenger',
      assignedAgentPrincipalId: owner,
    })
    await seedConversation(customer, { status: 'closed' })
    await seedConversation(customer)
    await seedConversation(visitor, { attrs: { test: 'true' } })
    const after = await countInboxScopes(actorFor(owner))
    expect(after.test).toBe(before.test + 3)
    expect(after.mine).toBe(before.mine)
    expect(after.unassigned).toBe(before.unassigned + 1)
  })

  it('bulk-deletes test-customer threads with their pair tickets, and nothing real', async () => {
    const mine = await seedConversation(customer, { status: 'closed' })
    const theirs = await seedConversation(otherCustomer)
    const teammate = await seedConversation(owner)
    const legacy = await seedConversation(visitor, { attrs: { test: true } })
    const pairTicket = await seedTicket(customer)
    const realTicket = await seedTicket(visitor)
    await testDb.insert(ticketConversations).values([
      { ticketId: pairTicket, conversationId: mine, ticketType: 'customer' },
      { ticketId: realTicket, conversationId: legacy, ticketType: 'customer' },
    ])

    const deleted = await deleteTestConversations(actorFor(owner))
    expect(deleted).toBeGreaterThanOrEqual(2)
    expect(await remainingConversations([mine, theirs, teammate, legacy])).toEqual(
      [teammate, legacy].sort()
    )
    expect(await remainingTickets([pairTicket, realTicket])).toEqual([realTicket])
  })

  it('sweeps week-old test-customer threads, ideas and tickets on the production path', async () => {
    const oldTest = await seedConversation(customer, { ageDays: 8 })
    const freshTest = await seedConversation(customer, { ageDays: 1 })
    const oldTeammate = await seedConversation(owner, { ageDays: 30 })
    const oldLegacy = await seedConversation(visitor, {
      ageDays: 30,
      attrs: { test: 'true', testOwnerPrincipalId: owner },
    })
    const oldTestPost = await seedPost(customer, 8)
    const freshTestPost = await seedPost(customer, 1)
    const oldTeammatePost = await seedPost(owner, 30)
    const oldLegacyPost = await seedPost(visitor, 30, { test: 'true' })
    const oldTestTicket = await seedTicket(customer, 8)
    const freshTestTicket = await seedTicket(customer, 1)
    const oldLegacyTicket = await seedTicket(visitor, 30, { test: true })

    const result = await sweepTestData()
    expect(result.conversations).toBeGreaterThanOrEqual(1)
    expect(result.posts).toBeGreaterThanOrEqual(1)
    expect(result.tickets).toBeGreaterThanOrEqual(1)
    expect(await remainingConversations([oldTest, freshTest, oldTeammate, oldLegacy])).toEqual(
      [freshTest, oldTeammate, oldLegacy].sort()
    )
    expect(
      await remainingPosts([oldTestPost, freshTestPost, oldTeammatePost, oldLegacyPost])
    ).toEqual([freshTestPost, oldTeammatePost, oldLegacyPost].sort())
    expect(await remainingTickets([oldTestTicket, freshTestTicket, oldLegacyTicket])).toEqual(
      [freshTestTicket, oldLegacyTicket].sort()
    )
  })
})
