import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import { principal, user, eq, session, verification } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))
import { ensurePrincipalForUser } from '@/lib/server/domains/principals/principal.factory'
import {
  getOrCreateTestCustomer,
  mintTestCustomerToken,
  consumeTestCustomerToken,
} from '../test-customer'
import { deriveTestAttributes, notTestPrincipal } from '../test-data'
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

it('derives test markers from the author and ingress while stripping client markers', async () => {
  const customer = await getOrCreateTestCustomer(owner, 'en')
  const ordinary = createId('principal')
  await testDb
    .insert(principal)
    .values({ id: ordinary, type: 'anonymous', role: 'user', createdAt: new Date() })
  const forged = {
    test: 'true',
    onboardingGenerated: 'true',
    testOwnerPrincipalId: owner,
    source: 'widget',
  }
  expect(await deriveTestAttributes(ordinary, forged, true)).toEqual({ source: 'widget' })
  expect(await deriveTestAttributes(customer.id, { test: 'false' }, true)).toEqual({
    test: true,
    testOwnerPrincipalId: owner,
  })
  expect(await deriveTestAttributes(owner, {}, true)).toEqual({
    test: true,
    testOwnerPrincipalId: owner,
  })
  expect(await deriveTestAttributes(owner, forged, false)).toEqual({ source: 'widget' })
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
