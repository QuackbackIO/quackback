/**
 * The one-time bootstrap promotion, against real Postgres.
 *
 * `ensureBootstrapAdmin` asks the principal table two different questions in
 * one transaction: is the caller already an admin, and does any human admin
 * exist. A hand-rolled db double answers both from a single stub and so
 * cannot tell a caller-scoped lookup from a workspace-wide one, which is
 * exactly the seam a promotion bug would hide in. Here the where clauses are
 * real, so the second question can actually disagree with the first.
 *
 * Two guards, not one: the workspace step refuses a caller who is not the
 * existing owner before it opens the transaction at all, and the transaction
 * decides again under the advisory lock for the case where ownership changed in
 * between. Both are exercised here, the second by staging that race.
 *
 * A third guard joins them, and it needs both workspace shapes to mean
 * anything: an install nobody provisioned, where the first human genuinely is
 * the owner, and a workspace a control plane created, where being first through
 * the door is a race anyone who can guess a hostname may enter. The two differ
 * by one real column read with real SQL — `settings.cloud_workspace_key`, which
 * migration 0258 documents as "NULL on self-hosted installs" — so the fixture
 * can actually tell them apart. It is added inside the test transaction because
 * the local development database predates that migration; the column, the
 * value and the query are all the real ones, and all three roll back.
 *
 * The sibling mock-based suite (onboarding-admin-promotion.fn.test.ts) keeps
 * the call-shape and managed-field coverage; this one is about the guards.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user, settings, eq, sql } from '@/lib/server/db'

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
  getSettings: vi.fn(),
  ensurePrincipalForUser: vi.fn(),
  setPrincipalRole: vi.fn(),
  invalidateSettingsCache: vi.fn(),
  findHumanAdmin: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.getSession }))
vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: hoisted.getSettings }))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  syncPrincipalProfile: vi.fn(),
}))
// The factory is stubbed so a refusal can be distinguished from a promotion by
// whether it was reached at all; the guard under test runs before it.
vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  ensurePrincipalForUser: hoisted.ensurePrincipalForUser,
  setPrincipalRole: hoisted.setPrincipalRole,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: hoisted.invalidateSettingsCache,
}))

// Passed through to the real implementation for every test but one, where it
// stands in for a workspace that gets claimed BETWEEN the entry gate's read and
// the transaction. That is the window the advisory lock exists for, and it is
// the only way to reach the guard inside it from out here.
const realBootstrap = await vi.importActual<
  typeof import('@/lib/server/domains/principals/bootstrap-admin')
>('@/lib/server/domains/principals/bootstrap-admin')

vi.mock('@/lib/server/domains/principals/bootstrap-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/principals/bootstrap-admin')>()),
  findHumanAdmin: hoisted.findHumanAdmin,
}))

import { saveWorkspaceAndGoalFn } from '../onboarding'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: principal.id, role: principal.role, type: principal.type })
      .from(principal)
      .limit(0)
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
    // Migration 0258's column, probed rather than created. `ALTER TABLE` from
    // inside the fixture's transaction would hold ACCESS EXCLUSIVE on
    // `settings` for the whole test, and two suites doing that at once deadlock.
    await db.execute(
      sql`select cloud_workspace_key, cloud_identity, cloud_identity_revision from settings limit 0`
    )
  },
})

/**
 * The control plane's claim on this database, planted for the length of one
 * rolled-back transaction. Nothing in the app writes this: it comes from
 * provisioning, which is what makes it a fact about the workspace rather than a
 * flag somebody here can flip.
 */
async function seedProvisionedWorkspace(): Promise<void> {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(),
  })
  await testDb.execute(sql`UPDATE settings SET cloud_workspace_key = 'ws_acme'`)
}

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

const WORKSPACE_INPUT = { workspaceName: 'Acme', useCase: 'product_feedback' as const }

describe.skipIf(!fixture.available)('bootstrap promotion guard', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
    // No settings row: the branch that reaches ensureBootstrapAdmin.
    hoisted.getSettings.mockResolvedValue(undefined)
    hoisted.ensurePrincipalForUser.mockResolvedValue({
      created: true,
      principal: { id: 'principal_new', role: 'admin' },
    })
    hoisted.findHumanAdmin.mockImplementation(realBootstrap.findHumanAdmin)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('refuses to promote a second user while a human admin already owns setup', async () => {
    const ownerId = await seedUser('owner@acme.example')
    await seedPrincipal({ userId: ownerId, role: 'admin' })
    const intruderId = await seedUser('someone.else@acme.example')
    hoisted.getSession.mockResolvedValue({ user: { id: intruderId } })

    await expect(saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })).rejects.toThrow(/only admin/i)
    expect(hoisted.ensurePrincipalForUser).not.toHaveBeenCalled()
    expect(hoisted.setPrincipalRole).not.toHaveBeenCalled()
  })

  it('refuses a caller who already has a non-admin principal here', async () => {
    const ownerId = await seedUser('owner@acme.example')
    await seedPrincipal({ userId: ownerId, role: 'admin' })
    const memberId = await seedUser('member@acme.example')
    await seedPrincipal({ userId: memberId, role: 'member' })
    hoisted.getSession.mockResolvedValue({ user: { id: memberId } })

    await expect(saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })).rejects.toThrow(/only admin/i)
    expect(hoisted.ensurePrincipalForUser).not.toHaveBeenCalled()
  })

  // A service principal is not a human owner, so it must not block the first
  // real user from claiming setup.
  it('still promotes the first human when only a service admin exists', async () => {
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId: null,
      role: 'admin',
      type: 'service',
      createdAt: new Date(),
    })
    const firstId = await seedUser('first@acme.example')
    hoisted.getSession.mockResolvedValue({ user: { id: firstId } })

    await saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })

    expect(hoisted.ensurePrincipalForUser).toHaveBeenCalledWith(
      { userId: firstId, role: 'admin' },
      expect.any(Object)
    )
  })

  it('lets the seeded owner through without a second promotion', async () => {
    const ownerId = await seedUser('owner@acme.example')
    await seedPrincipal({ userId: ownerId, role: 'admin' })
    hoisted.getSession.mockResolvedValue({ user: { id: ownerId } })

    await saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })

    // Already an admin: the guard returns before touching the role writer.
    expect(hoisted.ensurePrincipalForUser).not.toHaveBeenCalled()
    expect(hoisted.setPrincipalRole).not.toHaveBeenCalled()
  })

  it('promotes the first user on a workspace nobody has claimed', async () => {
    const firstId = await seedUser('first@acme.example')
    hoisted.getSession.mockResolvedValue({ user: { id: firstId } })

    await saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })

    expect(hoisted.ensurePrincipalForUser).toHaveBeenCalledWith(
      { userId: firstId, role: 'admin' },
      expect.any(Object)
    )
  })

  // The path every real first user now takes. Accounts are created with a
  // principal at role 'user', so by the time anyone reaches the workspace step
  // the row already exists and creating it is a no-op — the promotion has to
  // come from the role write. The double answers from the real table here
  // rather than a fixed value, because "already exists" is exactly the fact it
  // has to get right for this test to mean anything.
  it('upgrades a first user whose principal was already created at the default role', async () => {
    const firstId = await seedUser('first@acme.example')
    await seedPrincipal({ userId: firstId, role: 'user' })
    hoisted.getSession.mockResolvedValue({ user: { id: firstId } })
    hoisted.ensurePrincipalForUser.mockImplementation(async ({ userId }: { userId: UserId }) => {
      const existing = await testDb.query.principal.findFirst({
        where: eq(principal.userId, userId),
      })
      return existing
        ? { created: false, principal: existing }
        : { created: true, principal: { id: 'principal_new', role: 'admin' } }
    })

    await saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })

    expect(hoisted.setPrincipalRole).toHaveBeenCalledWith(
      { userId: firstId },
      'admin',
      expect.objectContaining({ knownUserId: firstId })
    )
  })

  // The race the advisory lock exists for, staged: the entry gate reads an
  // unowned workspace, and by the time the transaction runs somebody else has
  // claimed it. The guard inside the lock is the last thing standing between
  // that and two admins, so it has to refuse on its own.
  it('refuses a claim that lost the race after the entry gate read', async () => {
    const ownerId = await seedUser('owner@acme.example')
    await seedPrincipal({ userId: ownerId, role: 'admin' })
    const loserId = await seedUser('loser@acme.example')
    hoisted.getSession.mockResolvedValue({ user: { id: loserId } })
    hoisted.findHumanAdmin
      .mockImplementationOnce(async () => undefined)
      .mockImplementation(realBootstrap.findHumanAdmin)

    await expect(saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })).rejects.toThrow(
      /already claimed by an admin/i
    )
    expect(hoisted.ensurePrincipalForUser).not.toHaveBeenCalled()
    expect(hoisted.setPrincipalRole).not.toHaveBeenCalled()
  })

  // The workspace this guard exists for: a control plane created it for a
  // named customer, provisioning could not resolve that customer's address, so
  // no owner was recorded. Nobody has ever signed in, the hostname sits in an
  // enumerable set, and before this guard the first arrival became its admin.
  it('refuses to hand a provisioned workspace to whoever arrives first', async () => {
    await seedProvisionedWorkspace()
    const arrivalId = await seedUser('whoever@evil.example')
    hoisted.getSession.mockResolvedValue({ user: { id: arrivalId } })

    await expect(saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })).rejects.toThrow(
      /not open to be set up/i
    )
    expect(hoisted.ensurePrincipalForUser).not.toHaveBeenCalled()
    expect(hoisted.setPrincipalRole).not.toHaveBeenCalled()
  })

  // Same refusal for the arrival who already holds a portal account here —
  // signing up first and then walking to the workspace step is the same move
  // with one more step in it.
  it('refuses an arrival who already has a default-role principal there', async () => {
    await seedProvisionedWorkspace()
    const arrivalId = await seedUser('whoever@evil.example')
    await seedPrincipal({ userId: arrivalId, role: 'user' })
    hoisted.getSession.mockResolvedValue({ user: { id: arrivalId } })

    await expect(saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })).rejects.toThrow(
      /not open to be set up/i
    )
    expect(hoisted.setPrincipalRole).not.toHaveBeenCalled()
  })

  // The control that proves the two above are deciding on the stamp. Same
  // settings row, same caller, stamp removed: the self-hosted install, which
  // must keep promoting its first human exactly as it always has.
  it('still promotes the first human once the stamp is gone', async () => {
    await seedProvisionedWorkspace()
    await testDb.execute(sql`UPDATE settings SET cloud_workspace_key = NULL`)
    hoisted.getSettings.mockResolvedValue({ id: 'workspace_1' })
    const firstId = await seedUser('first@acme.example')
    hoisted.getSession.mockResolvedValue({ user: { id: firstId } })

    await saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })

    expect(hoisted.ensurePrincipalForUser).toHaveBeenCalledWith(
      { userId: firstId, role: 'admin' },
      expect.any(Object)
    )
  })

  // The stamp's older home. A workspace stamped before the dedicated column
  // existed and never re-stamped carries only this, and reading one source
  // would leave that whole cohort claimable.
  it('refuses on a workspace stamped only in the metadata bag', async () => {
    await testDb.insert(settings).values({
      id: createId('workspace'),
      name: 'Acme',
      slug: `acme-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date(),
      metadata: JSON.stringify({ cloudTenant: { v: 1, workspaceKey: 'ws_acme', stampedAt: '' } }),
    })
    const arrivalId = await seedUser('whoever@evil.example')
    hoisted.getSession.mockResolvedValue({ user: { id: arrivalId } })

    await expect(saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })).rejects.toThrow(
      /not open to be set up/i
    )
    expect(hoisted.ensurePrincipalForUser).not.toHaveBeenCalled()
  })

  // A provisioned workspace whose owner WAS recorded is unaffected: they are
  // already an admin, so they never reach the claim branch at all.
  it('lets the recorded owner of a provisioned workspace through', async () => {
    await seedProvisionedWorkspace()
    hoisted.getSettings.mockResolvedValue({ id: 'workspace_1' })
    const ownerId = await seedUser('owner@acme.example')
    await seedPrincipal({ userId: ownerId, role: 'admin' })
    hoisted.getSession.mockResolvedValue({ user: { id: ownerId } })

    await saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })

    expect(hoisted.ensurePrincipalForUser).not.toHaveBeenCalled()
    expect(hoisted.setPrincipalRole).not.toHaveBeenCalled()
  })

  // Same starting shape, opposite answer: an owner already exists, so the
  // default-role principal must NOT be upgraded.
  it('does not upgrade a default-role principal once an owner exists', async () => {
    const ownerId = await seedUser('owner@acme.example')
    await seedPrincipal({ userId: ownerId, role: 'admin' })
    const visitorId = await seedUser('visitor@acme.example')
    await seedPrincipal({ userId: visitorId, role: 'user' })
    hoisted.getSession.mockResolvedValue({ user: { id: visitorId } })

    await expect(saveWorkspaceAndGoalFn({ data: WORKSPACE_INPUT })).rejects.toThrow(/only admin/i)
    expect(hoisted.setPrincipalRole).not.toHaveBeenCalled()
  })
})
