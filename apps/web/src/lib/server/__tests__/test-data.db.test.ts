/**
 * The test-data predicates are identity-only: a row is test exactly when a
 * test customer authored it. A teammate's own ingress and a legacy `test`
 * attribute a client once wrote are real data, so they stay counted.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { sql } from 'drizzle-orm'
import { createDbTestFixture, testDb } from './db-test-fixture'
import {
  conversations,
  principal,
  tickets,
  ticketConversations,
  ticketStatuses,
  user,
  eq,
  inArray,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))

import {
  activeTestOwnerOf,
  isTestPrincipalSql,
  notTestConversation,
  notTestPrincipal,
  notTestTicket,
  testOwnerOf,
} from '../test-data'

const fixture = await createDbTestFixture()
let owner: PrincipalId, customer: PrincipalId, visitor: PrincipalId

async function seedPrincipals() {
  owner = createId('principal')
  customer = createId('principal')
  visitor = createId('principal')
  const uid = createId('user') as UserId
  await testDb.insert(user).values({ id: uid, name: 'Acme', email: `${uid}@example.com` })
  await testDb.insert(principal).values([
    { id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() },
    { id: visitor, role: 'user', type: 'anonymous', createdAt: new Date() },
  ])
  await testDb.insert(principal).values({
    id: customer,
    role: 'user',
    type: 'anonymous',
    testOwnerPrincipalId: owner,
    createdAt: new Date(),
  })
}

async function seedConversation(visitorPrincipalId: PrincipalId, attrs: Record<string, unknown>) {
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId, channel: 'messenger', customAttributes: attrs })
    .returning({ id: conversations.id })
  return row.id
}

describe.skipIf(!fixture.available)('identity-only test data (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    await seedPrincipals()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('classifies principals by the stored owner only, null-safe', async () => {
    const ids = [owner, customer, visitor]
    const rows = await testDb
      .select({
        id: principal.id,
        test: isTestPrincipalSql(principal.id).mapWith(Boolean),
        real: sql<boolean>`${notTestPrincipal(principal.id)}`,
      })
      .from(principal)
      .where(inArray(principal.id, ids))
    const byId = Object.fromEntries(rows.map((r) => [r.id, [r.test, r.real]]))
    expect(byId).toEqual({
      [owner]: [false, true],
      [customer]: [true, false],
      [visitor]: [false, true],
    })
    const [nullRow] = await testDb.execute<{ test: boolean; real: boolean }>(
      sql`select ${isTestPrincipalSql(sql`null::uuid`)} as test, ${notTestPrincipal(sql`null::uuid`)} as real`
    )
    expect(nullRow).toMatchObject({ test: false, real: true })
  })

  it('treats a legacy client test attribute and a teammate thread as real conversations', async () => {
    const legacy = await seedConversation(visitor, { test: 'true', onboardingGenerated: 'true' })
    const teammate = await seedConversation(owner, {})
    const testThread = await seedConversation(customer, {})
    const rows = await testDb
      .select({
        id: conversations.id,
        real: sql<boolean>`${notTestConversation(conversations.id)}`,
      })
      .from(conversations)
      .where(inArray(conversations.id, [legacy, teammate, testThread]))
    expect(Object.fromEntries(rows.map((r) => [r.id, r.real]))).toEqual({
      [legacy]: true,
      [teammate]: true,
      [testThread]: false,
    })
  })

  it('treats a ticket as test by its requester or a linked test conversation, never by attributes', async () => {
    const [status] = await testDb
      .insert(ticketStatuses)
      .values({ name: 'Acme open', slug: createId('ticket_status') })
      .returning()
    const [legacy, requested, linked] = await testDb
      .insert(tickets)
      .values([
        {
          title: 'Acme legacy',
          statusId: status.id,
          requesterPrincipalId: visitor,
          customAttributes: { test: true },
        },
        { title: 'Acme requested', statusId: status.id, requesterPrincipalId: customer },
        { title: 'Acme linked', statusId: status.id, requesterPrincipalId: visitor },
      ])
      .returning({ id: tickets.id })
    await testDb.insert(ticketConversations).values({
      ticketId: linked.id,
      conversationId: await seedConversation(customer, {}),
      ticketType: 'customer',
    })
    const rows = await testDb
      .select({ id: tickets.id, real: sql<boolean>`${notTestTicket(tickets.id)}` })
      .from(tickets)
      .where(inArray(tickets.id, [legacy.id, requested.id, linked.id]))
    expect(Object.fromEntries(rows.map((r) => [r.id, r.real]))).toEqual({
      [legacy.id]: true,
      [requested.id]: false,
      [linked.id]: false,
    })
  })

  it('reports the owner of a test customer and nothing for anyone else', async () => {
    expect(await testOwnerOf(customer)).toBe(owner)
    expect(await testOwnerOf(owner)).toBeNull()
    expect(await testOwnerOf(visitor)).toBeNull()
    expect(await testOwnerOf(null)).toBeNull()
  })

  it('stops answering an active owner once that owner leaves the team', async () => {
    expect(await activeTestOwnerOf(customer)).toBe(owner)
    await testDb.update(principal).set({ role: 'user' }).where(eq(principal.id, owner))
    expect(await activeTestOwnerOf(customer)).toBeNull()
    expect(await testOwnerOf(customer)).toBe(owner)
  })
})
