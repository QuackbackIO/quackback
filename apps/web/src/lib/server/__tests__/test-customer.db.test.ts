import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import {
  boards,
  conversationMessages,
  conversations,
  posts,
  principal,
  tickets,
  ticketStatuses,
  user,
  eq,
  session,
  verification,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))
import { ensurePrincipalForUser } from '@/lib/server/domains/principals/principal.factory'
import {
  getOrCreateTestCustomer,
  mintTestCustomerToken,
  consumeTestCustomerToken,
  isTestCustomerTokenPending,
} from '../test-customer'
import { notTestPrincipal } from '../test-data'
import { removePortalUser } from '../domains/users/user.service'
import { findContactsByEmail } from '../domains/users/user.dedup'
import { mergeAnonymousToIdentified } from '../auth/merge-anonymous'
const fixture = await createDbTestFixture()
let owner: PrincipalId
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  owner = createId('principal')
  const uid = createId('user')
  await testDb.insert(user).values({ id: uid, name: 'Acme', email: 'you@example.com' })
  await testDb
    .insert(principal)
    .values({ id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() })
})
afterEach(fixture.rollback)
afterAll(fixture.close)
it('creates one durable anonymous customer per owner with an unverified contact address', async () => {
  const first = await getOrCreateTestCustomer(owner, 'en')
  const again = await getOrCreateTestCustomer(owner, 'en')
  expect(first.id).toBe(again.id)
  expect(first).toMatchObject({
    type: 'anonymous',
    role: 'user',
    testOwnerPrincipalId: owner,
    contactEmail: 'you@example.com',
    displayName: 'Test customer',
  })
  const profile = await testDb.query.user.findFirst({ where: eq(user.id, first.userId!) })
  expect(profile).toMatchObject({ isAnonymous: true, emailVerified: false })
  expect(profile!.email).not.toBe('you@example.com')
  const [original] = await testDb.select().from(principal).where(eq(principal.id, owner))
  expect(original.testOwnerPrincipalId).toBeNull()
})
it('keeps each owner separate and removes the customer principal when its owner is removed', async () => {
  const uid = createId('user'),
    other = createId('principal')
  await testDb.insert(user).values({ id: uid, name: 'Acme', email: 'other@example.com' })
  await testDb
    .insert(principal)
    .values({ id: other, userId: uid, role: 'member', type: 'user', createdAt: new Date() })
  const first = await getOrCreateTestCustomer(owner, 'en')
  const second = await getOrCreateTestCustomer(other, 'en')
  expect(first.id).not.toBe(second.id)
  expect(second.contactEmail).toBe('other@example.com')
  await testDb.delete(principal).where(eq(principal.id, owner))
  expect(
    await testDb.query.principal.findFirst({ where: eq(principal.id, first.id) })
  ).toBeUndefined()
  expect(
    await testDb.query.principal.findFirst({ where: eq(principal.id, second.id) })
  ).toBeDefined()
})
it('refuses a portal identity as an owner', async () => {
  await testDb.update(principal).set({ role: 'user' }).where(eq(principal.id, owner))
  await expect(getOrCreateTestCustomer(owner, 'en')).rejects.toThrow(/team member/i)
})

it('mints a short one-time token for a widget session and consumes it once without changing the owner', async () => {
  const before = await testDb.query.principal.findFirst({ where: eq(principal.id, owner) })
  const issued = await mintTestCustomerToken(owner, 'en')
  expect(new Date(issued.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60_000)
  expect(new Date(issued.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000)
  const redeemed = await consumeTestCustomerToken(issued.token)
  expect(redeemed).toMatchObject({ principal: { testOwnerPrincipalId: owner } })
  expect(redeemed!.bearerToken).toMatch(/^customer-session-/)
  const stored = await testDb.query.session.findFirst({
    where: eq(session.token, redeemed!.bearerToken),
  })
  expect(stored).toMatchObject({ scope: 'widget', userId: redeemed!.user.id })
  expect(stored!.userId).not.toBe(before!.userId)
  expect(await consumeTestCustomerToken(issued.token)).toBeNull()
  expect(await testDb.query.principal.findFirst({ where: eq(principal.id, owner) })).toEqual(before)
})
it('rejects expired tokens and ordinary credentials', async () => {
  const issued = await mintTestCustomerToken(owner, 'en')
  await testDb
    .update(verification)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(verification.identifier, `test-customer-token:${issued.token}`))
  expect(await consumeTestCustomerToken(issued.token)).toBeNull()
  expect(await consumeTestCustomerToken('ordinary-session-token')).toBeNull()
})

it("tells the owner's computer whether its phone code is still waiting to be scanned", async () => {
  const issued = await mintTestCustomerToken(owner, 'en')
  expect(await isTestCustomerTokenPending(owner, issued.token)).toBe(true)
  await consumeTestCustomerToken(issued.token)
  expect(await isTestCustomerTokenPending(owner, issued.token)).toBe(false)

  const expiring = await mintTestCustomerToken(owner, 'en')
  await testDb
    .update(verification)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(verification.identifier, `test-customer-token:${expiring.token}`))
  expect(await isTestCustomerTokenPending(owner, expiring.token)).toBe(false)
})

it("never reports on another teammate's phone code", async () => {
  const uid = createId('user'),
    other = createId('principal')
  await testDb.insert(user).values({ id: uid, name: 'Acme', email: 'other@example.com' })
  await testDb
    .insert(principal)
    .values({ id: other, userId: uid, role: 'member', type: 'user', createdAt: new Date() })
  const issued = await mintTestCustomerToken(owner, 'en')
  expect(await isTestCustomerTokenPending(other, issued.token)).toBe(false)
  expect(await isTestCustomerTokenPending(owner, 'ordinary-session-token')).toBe(false)
})

it('keeps test tokens outside Better Auth cookie handoffs', async () => {
  const issued = await mintTestCustomerToken(owner, 'en')
  expect(
    await testDb.query.verification.findFirst({
      where: eq(verification.identifier, `one-time-token:${issued.token}`),
    })
  ).toBeUndefined()
  expect(await consumeTestCustomerToken(issued.token)).not.toBeNull()
})

it('never recreates a deleted test principal as an ordinary customer', async () => {
  const customer = await getOrCreateTestCustomer(owner, 'en')
  await testDb.delete(principal).where(eq(principal.id, owner))
  await expect(ensurePrincipalForUser({ userId: customer.userId!, role: 'user' })).rejects.toThrow(
    /test customer/i
  )
})
it('enforces one test customer per owner in the database', async () => {
  await getOrCreateTestCustomer(owner, 'en')
  await expect(
    testDb.transaction(async (tx) =>
      tx.insert(principal).values({
        type: 'anonymous',
        role: 'user',
        testOwnerPrincipalId: owner,
        createdAt: new Date(),
      })
    )
  ).rejects.toMatchObject({ cause: { code: '23505', constraint_name: 'principal_test_owner_idx' } })
})

it('stops redeeming a token once its owner has left the team', async () => {
  const issued = await mintTestCustomerToken(owner, 'en')
  await testDb.update(principal).set({ role: 'user' }).where(eq(principal.id, owner))
  expect(await consumeTestCustomerToken(issued.token)).toBeNull()
  await testDb.update(principal).set({ role: 'admin' }).where(eq(principal.id, owner))
  expect(await consumeTestCustomerToken(issued.token)).not.toBeNull()
})

it('removes a former teammate whose test customer still owns a thread, an idea and a ticket', async () => {
  const customer = await getOrCreateTestCustomer(owner, 'en')
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Acme ideas', slug: createId('board') })
    .returning()
  const [thread] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: customer.id, channel: 'messenger' })
    .returning()
  await testDb.insert(conversationMessages).values({
    conversationId: thread.id,
    principalId: customer.id,
    senderType: 'visitor',
    content: 'Hi! Is anyone there?',
  })
  const [idea] = await testDb
    .insert(posts)
    .values({ boardId: board.id, title: 'Acme idea', content: '', principalId: customer.id })
    .returning()
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Acme open', slug: createId('ticket_status') })
    .returning()
  const [ticket] = await testDb
    .insert(tickets)
    .values({ title: 'Acme ticket', statusId: status.id, requesterPrincipalId: customer.id })
    .returning()
  await testDb.update(principal).set({ role: 'user' }).where(eq(principal.id, owner))

  await removePortalUser(owner)

  expect(await testDb.query.principal.findFirst({ where: eq(principal.id, owner) })).toBeUndefined()
  expect(
    await testDb.query.principal.findFirst({ where: eq(principal.id, customer.id) })
  ).toBeUndefined()
  expect(
    await testDb.query.conversations.findFirst({ where: eq(conversations.id, thread.id) })
  ).toBeUndefined()
  expect(await testDb.query.posts.findFirst({ where: eq(posts.id, idea.id) })).toBeUndefined()
  expect(await testDb.query.tickets.findFirst({ where: eq(tickets.id, ticket.id) })).toBeUndefined()
  expect(
    await testDb.query.user.findFirst({ where: eq(user.id, customer.userId!) })
  ).toBeUndefined()
})

it('never merges a test customer into a real identity or lists it as a contact', async () => {
  const customer = await getOrCreateTestCustomer(owner, 'en')
  const [thread] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: customer.id, channel: 'messenger' })
    .returning()
  const realUser = createId('user'),
    real = createId('principal')
  await testDb.insert(user).values({ id: realUser, name: 'Acme', email: 'real@example.com' })
  await testDb
    .insert(principal)
    .values({ id: real, userId: realUser, role: 'user', type: 'user', createdAt: new Date() })

  await mergeAnonymousToIdentified({
    anonPrincipalId: customer.id,
    targetPrincipalId: real,
    anonUserId: customer.userId!,
    anonDisplayName: 'Test customer',
    targetDisplayName: 'Acme',
  })
  expect(
    await testDb.query.principal.findFirst({ where: eq(principal.id, customer.id) })
  ).toBeDefined()
  expect(
    (await testDb.query.conversations.findFirst({ where: eq(conversations.id, thread.id) }))!
      .visitorPrincipalId
  ).toBe(customer.id)

  // The test customer carries its owner's address, but it is nobody's contact.
  const matches = await findContactsByEmail('you@example.com')
  expect(matches.map((match) => match.principalId)).not.toContain(customer.id)
})

it('excludes test identities in a real query without excluding their owners', async () => {
  const customer = await getOrCreateTestCustomer(owner, 'en')
  const rows = await testDb
    .select({ id: principal.id })
    .from(principal)
    .where(notTestPrincipal(principal.id))
  expect(rows.map((row) => row.id)).toContain(owner)
  expect(rows.map((row) => row.id)).not.toContain(customer.id)
})
