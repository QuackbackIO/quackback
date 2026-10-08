/**
 * Who may run the workspace step, and when it stops running, against real
 * Postgres with the real role writer.
 *
 * The sibling guard suite (onboarding-bootstrap-claim.db.test.ts) stubs the
 * principal factory so a refusal can be told from a promotion by whether the
 * factory was reached. This one keeps the factory real and reads the outcome
 * back from the principal and settings tables: the question here is what the
 * workspace ends up with, not which branch ran.
 *
 * Every write rolls back with the fixture transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user, settings, eq, getSetupState } from '@/lib/server/db'

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

const hoisted = vi.hoisted(() => ({
  getSession: vi.fn(),
  isSetupOpenToClaim: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.getSession }))

// Passed through to the real predicate for every test but one, which stands in
// for a save whose early check ran before another tab finished setup.
const realBootstrap = await vi.importActual<
  typeof import('@/lib/server/domains/principals/bootstrap-admin')
>('@/lib/server/domains/principals/bootstrap-admin')
vi.mock('@/lib/server/domains/principals/bootstrap-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/principals/bootstrap-admin')>()),
  isSetupOpenToClaim: hoisted.isSetupOpenToClaim,
}))

import { saveWorkspaceAndGoalFn } from '../onboarding'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: principal.id, role: principal.role, type: principal.type })
      .from(principal)
      .limit(0)
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: settings.id, setupState: settings.setupState }).from(settings).limit(0)
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

/** An account as sign-up leaves it: a principal at the default role. */
async function seedAccount(email: string): Promise<UserId> {
  const userId = await seedUser(email)
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: 'user',
    type: 'user',
    createdAt: new Date(),
  })
  return userId
}

function signIn(userId: UserId | null): void {
  hoisted.getSession.mockResolvedValue(
    userId ? { session: { scope: 'dashboard' }, user: { id: userId } } : null
  )
}

async function roleOf(userId: UserId): Promise<string | undefined> {
  const row = await testDb.query.principal.findFirst({ where: eq(principal.userId, userId) })
  return row?.role
}

async function workspace() {
  const [row] = await testDb.select().from(settings)
  return row ? { name: row.name, useCase: getSetupState(row.setupState)?.useCase } : undefined
}

describe.skipIf(!fixture.available)('the workspace step', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
    hoisted.isSetupOpenToClaim.mockImplementation(realBootstrap.isSetupOpenToClaim)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('once setup is finished', () => {
    // Two tabs of the same admin. The first finishes setup; the second was
    // opened on the workspace step before that and is submitted afterwards.
    it('refuses a second save, even from the admin who finished it', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      signIn(ownerId)

      const first = await saveWorkspaceAndGoalFn({
        data: { workspaceName: 'Fernhill', useCase: 'customer_support' },
      })
      expect(first).toMatchObject({ ok: true, name: 'Fernhill' })
      expect(await roleOf(ownerId)).toBe('admin')

      const second = await saveWorkspaceAndGoalFn({
        data: { workspaceName: 'Second Tab Co', useCase: 'product_feedback' },
      })

      expect(second).toEqual({ ok: false, refusal: 'setup_complete' })
      expect(await workspace()).toEqual({ name: 'Fernhill', useCase: 'customer_support' })
    })

    // The early check runs outside any lock, so a save can pass it while
    // another tab is still finishing. The write itself has to refuse.
    it('refuses a save that passed the early check before the other tab finished', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      signIn(ownerId)
      await saveWorkspaceAndGoalFn({
        data: { workspaceName: 'Fernhill', useCase: 'customer_support' },
      })
      hoisted.isSetupOpenToClaim.mockResolvedValueOnce(true)

      const late = await saveWorkspaceAndGoalFn({
        data: { workspaceName: 'Second Tab Co', useCase: 'product_feedback' },
      })

      expect(late).toEqual({ ok: false, refusal: 'setup_complete' })
      expect(await workspace()).toEqual({ name: 'Fernhill', useCase: 'customer_support' })
    })

    // Same race on a fresh install, where the first save creates the settings
    // row rather than updating it.
    it('refuses a late save that would create a second settings row', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      signIn(ownerId)
      await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill' } })
      hoisted.isSetupOpenToClaim.mockResolvedValueOnce(true)
      // The late tab read "no settings yet" before the first one wrote them.
      const staleRead = vi
        .spyOn(testDb.query.settings, 'findFirst')
        .mockResolvedValueOnce(undefined as never)

      const late = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Second Tab Co' } })

      staleRead.mockRestore()
      expect(late).toEqual({ ok: false, refusal: 'setup_complete' })
      expect(await testDb.select({ name: settings.name }).from(settings)).toEqual([
        { name: 'Fernhill' },
      ])
    })
  })

  describe('a lost session', () => {
    it('is refused as signed out, and nothing is written', async () => {
      await seedAccount('owner@acme.example')
      signIn(null)

      const result = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill' } })

      expect(result).toEqual({ ok: false, refusal: 'signed_out' })
      expect(await workspace()).toBeUndefined()
    })
  })
})
