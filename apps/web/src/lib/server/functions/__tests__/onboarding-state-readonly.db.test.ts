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
import { isSetupBlocked, pickOnboardingStep } from '@/routes/onboarding/-onboarding-step'

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
  type?: 'user' | 'anonymous'
  createdAt?: Date
}): Promise<PrincipalId> {
  const id = createId('principal') as PrincipalId
  await testDb.insert(principal).values({
    id,
    userId: input.userId,
    role: input.role,
    type: input.type ?? 'user',
    createdAt: input.createdAt ?? new Date(),
  })
  return id
}

/** Two accounts on an install still being set up, created in this order. */
async function seedTwoAccounts(): Promise<{ firstId: UserId; secondId: UserId }> {
  const firstId = await seedUser('first@acme.example')
  await seedPrincipal({ userId: firstId, role: 'user', createdAt: new Date('2026-10-01T09:00Z') })
  const secondId = await seedUser('second@elsewhere.example')
  await seedPrincipal({ userId: secondId, role: 'user', createdAt: new Date('2026-10-01T09:05Z') })
  return { firstId, secondId }
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

  // A finished self-hosted install whose only admin is an API principal. A
  // portal user who signs in from the account screen is routed by this state;
  // routing them to the workspace step would end in its refusal.
  it('reports a finished install with no human admin as closed to the claim', async () => {
    await testDb.execute(sql`
      INSERT INTO settings (id, name, slug, created_at, setup_state)
      VALUES (
        gen_random_uuid(), 'Acme', ${'acme-' + Math.random().toString(36).slice(2, 8)}, now(),
        ${JSON.stringify({
          version: 2,
          steps: {
            core: true,
            workspace: true,
            startingPoint: {
              outcome: 'product_feedback',
              resourceType: 'none',
              source: 'wizard',
              resolution: 'deferred',
              completedAt: '2026-08-01T00:00:00.000Z',
            },
          },
          useCase: 'product_feedback',
          completionSource: 'wizard',
        })}
      )
    `)
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId: null,
      role: 'admin',
      type: 'service',
      createdAt: new Date(),
    })
    const visitorId = await seedUser('visitor@elsewhere.example')
    await seedPrincipal({ userId: visitorId, role: 'user' })
    hoisted.getSession.mockResolvedValue({ user: { id: visitorId } })

    const state = await checkOnboardingState()

    expect(state.setupClaimedByOther).toBe(false)
    // Not provisioned: the workspace step's control-plane branch stays off.
    expect(state.setupOpenToClaim).toBe(true)
    expect(state.setupClosedReason).toBe('setupComplete')
    expect(isSetupBlocked(state)).toBe(true)
    expect(pickOnboardingStep({ session: { userId: visitorId }, state })).toBe(
      '/onboarding/no-access'
    )
  })

  // The first account created on an install still being set up has claimed
  // it, so a second account is routed to the refusal rather than walked to a
  // workspace form that would refuse it at the end.
  it('reports a second account on an install being set up as blocked', async () => {
    const { secondId } = await seedTwoAccounts()
    hoisted.getSession.mockResolvedValue({ user: { id: secondId } })

    const state = await checkOnboardingState()

    expect(state.setupClaimedByOther).toBe(true)
    expect(pickOnboardingStep({ session: { userId: secondId }, state })).toBe(
      '/onboarding/no-access'
    )
  })

  // The claimant signing back in, after the wizard's Sign out or a lost
  // session, goes back to the workspace step to finish.
  it('sends the account that claimed setup back to the workspace step', async () => {
    const { firstId } = await seedTwoAccounts()
    hoisted.getSession.mockResolvedValue({ user: { id: firstId } })

    const state = await checkOnboardingState()

    expect(state.setupClaimedByOther).toBe(false)
    expect(pickOnboardingStep({ session: { userId: firstId }, state })).toBe(
      '/onboarding/workspace'
    )
    expect(await roleOf(firstId)).toBe('user')
  })

  it('does not count an anonymous visitor who arrived first as the claimant', async () => {
    const visitorId = await seedUser('temp-visitor@anon.quackback.io')
    await seedPrincipal({
      userId: visitorId,
      role: 'user',
      type: 'anonymous',
      createdAt: new Date('2026-10-01T08:00Z'),
    })
    const { firstId } = await seedTwoAccounts()
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
