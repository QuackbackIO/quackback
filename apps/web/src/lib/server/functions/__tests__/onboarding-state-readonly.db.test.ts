/**
 * `checkOnboardingState` is what four onboarding loaders call to decide where
 * to send the caller. A loader runs on every page load, including one the
 * visitor reached by typing the URL, so it must report and never write.
 *
 * It is exercised against real Postgres because the defect is a WRITE: a double
 * that stands in for the principal factory can only prove the factory was not
 * called, while the row itself is what decides who is an admin. Here the table
 * is real, so the count before and after the call is the assertion.
 *
 * Every write rolls back with the fixture transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user, eq, sql } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => ({}) }))

const hoisted = vi.hoisted(() => ({ getSession: vi.fn(), getSettings: vi.fn() }))
vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.getSession }))
vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: hoisted.getSettings }))

import { checkOnboardingState } from '../admin'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: principal.id, role: principal.role, type: principal.type })
      .from(principal)
      .limit(0)
    await db.select({ id: user.id }).from(user).limit(0)
  },
})

async function seedUser(email: string): Promise<UserId> {
  const id = createId('user') as UserId
  await testDb.insert(user).values({
    id,
    name: email.split('@')[0],
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

async function seedPrincipal(input: {
  userId: UserId
  role: 'admin' | 'member' | 'user'
}): Promise<PrincipalId> {
  const id = createId('principal') as PrincipalId
  await testDb.insert(principal).values({
    id,
    userId: input.userId,
    role: input.role,
    type: 'user',
    createdAt: new Date(),
  })
  return id
}

async function principalCount(): Promise<number> {
  const [row] = await testDb.select({ n: sql<number>`count(*)::int` }).from(principal)
  return row!.n
}

async function roleOf(userId: UserId): Promise<string | null> {
  const found = await testDb.query.principal.findFirst({ where: eq(principal.userId, userId) })
  return found?.role ?? null
}

describe.skipIf(!fixture.available)('checkOnboardingState reports without mutating', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
    hoisted.getSettings.mockResolvedValue(undefined)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  // The defect this pins: loading a page while signed in on a workspace with no
  // human admin handed the loader's caller the admin role, with no lock and no
  // transaction. Promotion belongs to the one guarded writer the workspace step
  // calls, so this must leave the table exactly as it found it.
  //
  // A promoting implementation fails this either way: a write that lands moves
  // the count, and a write that errors leaves the fixture transaction aborted so
  // the count query itself cannot run.
  it('does not create an admin principal for the first signed-in caller', async () => {
    const firstId = await seedUser('first@acme.example')
    hoisted.getSession.mockResolvedValue({ user: { id: firstId } })
    const before = await principalCount()

    const state = await checkOnboardingState()

    expect(await principalCount()).toBe(before)
    expect(await roleOf(firstId)).toBeNull()
    // Nobody owns setup, so this caller may still go on to claim it.
    expect(state.setupClaimedByOther).toBe(false)
  })

  it('does not promote a caller who already has a default-role principal', async () => {
    const firstId = await seedUser('first@acme.example')
    await seedPrincipal({ userId: firstId, role: 'user' })
    hoisted.getSession.mockResolvedValue({ user: { id: firstId } })

    const state = await checkOnboardingState()

    expect(await roleOf(firstId)).toBe('user')
    expect(state.setupClaimedByOther).toBe(false)
  })

  // Every account gets a principal at creation, so this is what a non-owner
  // signing in on the account screen actually looks like: a principal exists,
  // and an admin who is somebody else owns setup.
  it('reports a non-owner with a principal as blocked by the existing owner', async () => {
    const ownerId = await seedUser('owner@acme.example')
    await seedPrincipal({ userId: ownerId, role: 'admin' })
    const visitorId = await seedUser('visitor@acme.example')
    await seedPrincipal({ userId: visitorId, role: 'user' })
    hoisted.getSession.mockResolvedValue({ user: { id: visitorId } })
    const before = await principalCount()

    const state = await checkOnboardingState()

    expect(state.setupClaimedByOther).toBe(true)
    expect(await principalCount()).toBe(before)
    expect(await roleOf(visitorId)).toBe('user')
  })

  it('does not treat the owner as blocked by their own claim', async () => {
    const ownerId = await seedUser('owner@acme.example')
    await seedPrincipal({ userId: ownerId, role: 'admin' })
    hoisted.getSession.mockResolvedValue({ user: { id: ownerId } })

    const state = await checkOnboardingState()

    expect(state.setupClaimedByOther).toBe(false)
    expect(state.principalRecord?.role).toBe('admin')
  })

  // A service principal is not a human owner: it must not block the first real
  // user, exactly as the bootstrap promoter treats it.
  it('does not let a service-principal admin read as the owner', async () => {
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId: null,
      role: 'admin',
      type: 'service',
      createdAt: new Date(),
    })
    const firstId = await seedUser('first@acme.example')
    hoisted.getSession.mockResolvedValue({ user: { id: firstId } })

    const state = await checkOnboardingState()

    expect(state.setupClaimedByOther).toBe(false)
  })

  it('answers an unauthenticated caller with the empty state and no writes', async () => {
    hoisted.getSession.mockResolvedValue(null)
    const before = await principalCount()

    const state = await checkOnboardingState()

    expect(state.principalRecord).toBeNull()
    expect(state.setupClaimedByOther).toBe(false)
    expect(await principalCount()).toBe(before)
  })
})
