/**
 * The plan limits state against a real database: detection on read, the
 * stored state, the cache and its invalidation, the choosers, and an install
 * without plan billing.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PrincipalId,
  type UserId,
  type WorkspaceId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  identityProvider,
  isNull,
  posts,
  principal,
  principalRoleAssignments,
  roles,
  session,
  settings,
  sql,
  statusComponents,
  user,
  webhooks,
} from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

const spies = vi.hoisted(() => ({
  loadUsageCounts: vi.fn(),
  readsNoState: false,
  cache: new Map<string, unknown>(),
}))

// The application cache, kept in memory: its kv rows are shared by every test
// file on the database, and a write that collides with another file's commit
// aborts this test's transaction.
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) =>
    spies.cache.has(key) ? structuredClone(spies.cache.get(key)) : null,
  cacheSet: async (key: string, value: unknown) => {
    spies.cache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) spies.cache.delete(key)
  },
}))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// A copy of the settings read before another process stored its state.
vi.mock('@/lib/server/domains/settings/settings.plan-limits', async (original) => {
  const real = await original<typeof import('@/lib/server/domains/settings/settings.plan-limits')>()
  return {
    ...real,
    readPlanLimitsSources: async () => {
      const sources = await real.readPlanLimitsSources()
      return spies.readsNoState && sources ? { ...sources, planLimitsState: null } : sources
    },
  }
})
// The provider's saved secret, read as the auth layer reads it: by credential type.
vi.mock(
  '@/lib/server/domains/platform-credentials/platform-credential.service',
  async (original) => ({
    ...(await original<
      typeof import('@/lib/server/domains/platform-credentials/platform-credential.service')
    >()),
    getConfiguredIntegrationTypes: async () => new Set(['auth_acme-sso']),
  })
)
vi.mock('@/lib/server/domains/billing/usage-counts', async (original) => {
  const real = await original<typeof import('@/lib/server/domains/billing/usage-counts')>()
  spies.loadUsageCounts.mockImplementation(real.loadUsageCounts)
  return { ...real, loadUsageCounts: spies.loadUsageCounts }
})

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { getWorkspaceSettings } from '@/lib/server/domains/settings/settings.service'
import { isSsoLive } from '@/lib/server/auth/registered-providers'
import { deleteBoard } from '@/lib/server/domains/boards/board.service'
import { removeTeamMember } from '@/lib/server/domains/principals/principal.service'
import { countSeatUsage } from '@/lib/server/domains/principals/seat-usage'
import { deleteStatusComponent } from '@/lib/server/domains/status/status.components'
import { writeBillingProjection } from '@/lib/server/domains/settings/cloud/billing-projection.write'
import { parseBillingProjection } from '@/lib/server/domains/settings/cloud/billing-projection'
import {
  getTierLimits,
  invalidateTierLimitsCache,
} from '@/lib/server/domains/settings/tier-limits.service'
import { mergeTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { resolveCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { planFeatureSet } from '../plan-limits.features'
import { planBillingOn } from './plan-billing'
import { graceEndFor, limitsKeyFor } from '../plan-limits.rules'
import { writeTierLimits } from '@/lib/server/domains/settings/tier-limits.write'
import { compareAndSetPlanLimitsState } from '@/lib/server/domains/settings/settings.plan-limits'
import {
  detectPlanLimits,
  detectPlanLimitsAfterProjectionWrite,
  getPlanLimits,
  getPlanLimitsWithCandidates,
  invalidatePlanLimits,
  isBoardOpen,
  isFeatureLive,
  isFeaturePaused,
  isSeatPaused,
  openBoardIds,
} from '../plan-limits.service'
import { setKeptBoard, setSeatHolders } from '../plan-limits.choosers'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

let settingsId: WorkspaceId
let ownerId: PrincipalId

/** `planBilling` off is an install without plan billing; `cloud` overrides it. */
async function configure(options: {
  planBilling: boolean
  tierLimits?: Record<string, unknown> | null
  cloud?: unknown
}) {
  await testDb
    .update(settings)
    .set({
      tierLimits: options.tierLimits === null ? null : JSON.stringify(options.tierLimits ?? {}),
      cloud: (options.cloud ?? (options.planBilling ? planBillingOn() : null)) as never,
    })
    .where(eq(settings.id, settingsId))
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
}

const FREE_LIKE = {
  ...OSS_TIER_LIMITS,
  maxBoards: 1,
  features: { ...OSS_TIER_LIMITS.features, webhooks: false },
}

async function addBoard(name: string, postCount: number, createdAt: Date): Promise<BoardId> {
  const id = createId('board') as BoardId
  await testDb.insert(boards).values({ id, name, slug: String(id), createdAt })
  for (let i = 0; i < postCount; i++) {
    await testDb
      .insert(posts)
      .values({ boardId: id, title: `Acme ${i}`, content: '', principalId: ownerId })
  }
  return id
}

async function ensureSettings(): Promise<WorkspaceId> {
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (row) return row.id
  const [created] = await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
    .returning({ id: settings.id })
  return created!.id
}

async function storedState(): Promise<Record<string, unknown> | null> {
  const [row] = await testDb
    .select({ state: settings.planLimitsState })
    .from(settings)
    .where(eq(settings.id, settingsId))
  return (row?.state as Record<string, unknown> | null) ?? null
}

describe.skipIf(!fixture.available)('plan limits state (real DB)', () => {
  let small: BoardId
  let big: BoardId

  beforeEach(async () => {
    await fixture.begin()
    vi.useRealTimers()
    spies.loadUsageCounts.mockClear()
    spies.readsNoState = false
    spies.cache.clear()
    settingsId = await ensureSettings()
    await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    const uid = createId('user') as UserId
    ownerId = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: uid, name: 'Acme Owner', email: `${uid}@example.com` })
    await testDb
      .insert(principal)
      // The earliest owner, whatever else the database holds.
      .values({ id: ownerId, userId: uid, role: 'admin', type: 'user', createdAt: new Date(0) })
    small = await addBoard('Acme small', 1, new Date('2026-01-01T00:00:00.000Z'))
    big = await addBoard('Acme big', 3, new Date('2026-02-01T00:00:00.000Z'))
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('is ok and stores nothing without plan billing, without counting anything', async () => {
    await configure({ planBilling: false, tierLimits: FREE_LIKE })
    const limits = await getPlanLimits()
    expect(limits.phase).toBe('ok')
    expect(limits.issues).toEqual([])
    expect(await storedState()).toBeNull()
    expect(spies.loadUsageCounts).not.toHaveBeenCalled()
    expect(await isBoardOpen(small)).toBe(true)
    expect(await isFeaturePaused('webhooks')).toBe(false)
    // The plan's own answer: it does not have webhooks.
    expect(await isFeatureLive('webhooks')).toBe(false)
  })

  it('is ok without counting anything when nothing is capped', async () => {
    await configure({ planBilling: true })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(spies.loadUsageCounts).not.toHaveBeenCalled()
    expect(await storedState()).toBeNull()
  })

  it('starts the grace on first detection and stores it once', async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    const first = await getPlanLimits()
    expect(first.phase).toBe('grace')
    expect(first.issues.map((i) => [i.key, i.used, i.cap])).toEqual([['maxBoards', 2, 1]])
    const stored = await storedState()
    expect(stored).toMatchObject({ since: first.since, graceEndsAt: first.graceEndsAt })
    // Seven days, then on to the next 12:00 UTC.
    const length = Date.parse(first.graceEndsAt!) - Date.parse(first.since!)
    expect(length).toBeGreaterThanOrEqual(7 * DAY)
    expect(length).toBeLessThan(8 * DAY)
    expect(first.graceEndsAt).toMatch(/T12:00:00\.000Z$/)
    expect(first.deadlineDay).toBe(
      new Date(Date.parse(first.graceEndsAt!) - DAY).toISOString().slice(0, 10)
    )

    const again = await getPlanLimits(new Date(Date.now() + DAY))
    expect(again.since).toBe(first.since)
    expect(await isBoardOpen(small)).toBe(true)
  })

  it('freezes the boards past the cap after the grace, keeping the one with most posts', async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    await getPlanLimits()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect((await getPlanLimits()).phase).toBe('enforced')
    expect(await openBoardIds()).toEqual([big])
    expect(await isBoardOpen(big)).toBe(true)
    expect(await isBoardOpen(small)).toBe(false)
  })

  it("keeps the admin's chosen board and refuses one that does not exist", async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    expect(await setKeptBoard(createId('board'))).toEqual({ ok: false, reason: 'unknown' })
    expect(await setKeptBoard(small)).toEqual({ ok: true })
    expect((await storedState())?.keptBoardId).toBe(small)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect(await isBoardOpen(small)).toBe(true)
    expect(await isBoardOpen(big)).toBe(false)
  })

  it('refuses a choice for a cap that is not over', async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    expect(await setSeatHolders([ownerId])).toEqual({ ok: false, reason: 'not_over' })
  })

  it('serves the cached count until a counted resource changes, then shows the fix at once', async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    // The first read stores the state, which drops the inputs; the second caches them.
    await getPlanLimits()
    expect((await getPlanLimits()).phase).toBe('grace')
    await testDb.update(boards).set({ deletedAt: new Date() }).where(eq(boards.id, small))
    expect((await getPlanLimits()).phase).toBe('grace')
    expect(spies.loadUsageCounts).toHaveBeenCalledTimes(2)
    await invalidatePlanLimits()
    expect((await getPlanLimits()).phase).toBe('ok')
  })

  it('shows the fix at once when a board is deleted through the board service', async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    await getPlanLimits()
    expect((await getPlanLimits()).phase).toBe('grace')
    await deleteBoard(small)
    expect((await getPlanLimits()).phase).toBe('ok')
  })

  it('shows the fix at once when a status component is deleted', async () => {
    await configure({
      planBilling: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null, maxStatusComponents: 0 },
    })
    const [component] = await testDb
      .insert(statusComponents)
      .values({ name: 'Acme API' })
      .returning({ id: statusComponents.id })
    await invalidatePlanLimits()
    await getPlanLimits()
    expect((await getPlanLimits()).issues.map((i) => i.key)).toContain('maxStatusComponents')
    await deleteStatusComponent(component!.id)
    expect((await getPlanLimits()).issues.map((i) => i.key)).not.toContain('maxStatusComponents')
  })

  it('gives no new grace for going back over the same limits after the grace ended', async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    const first = await getPlanLimits()
    await testDb.update(boards).set({ deletedAt: new Date() }).where(eq(boards.id, small))
    await invalidatePlanLimits()
    expect((await getPlanLimits()).phase).toBe('ok')
    await testDb.update(boards).set({ deletedAt: null }).where(eq(boards.id, small))
    await invalidatePlanLimits()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 30 * DAY })
    const again = await getPlanLimits()
    expect(again.phase).toBe('enforced')
    expect(again.since).toBe(first.since)
  })

  it('judges the grace by the shared settings, never a stale per-process copy of the limits', async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    const first = await getPlanLimits()
    expect(first.phase).toBe('grace')
    // Another process still holds the limits from before the drop.
    const freeRow = (await testDb.select().from(settings).where(eq(settings.id, settingsId)))[0]!
    await testDb
      .update(settings)
      .set({ tierLimits: JSON.stringify({ ...FREE_LIKE, maxBoards: null }) })
      .where(eq(settings.id, settingsId))
    invalidateTierLimitsCache()
    expect((await getTierLimits()).maxBoards).toBeNull()
    await testDb
      .update(settings)
      .set({ tierLimits: freeRow.tierLimits })
      .where(eq(settings.id, settingsId))
    await invalidateSettingsCache()
    expect((await getTierLimits()).maxBoards).toBeNull()

    const stale = await getPlanLimits()
    expect(stale.phase).toBe('grace')
    expect(stale.since).toBe(first.since)
    expect((await storedState())?.since).toBe(first.since)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    const later = await getPlanLimits()
    expect(later.phase).toBe('enforced')
    expect(later.since).toBe(first.since)
  })

  it('gives a workspace already over a fresh grace from first detection, however long ago its term lapsed', async () => {
    const now = new Date()
    vi.useFakeTimers({ toFake: ['Date'], now })
    const lapsed = lapsedProjection(new Date(now.getTime() - 30 * DAY))
    await configure({
      planBilling: true,
      tierLimits: null,
      cloud: { enabled: true, projection: lapsed },
    })
    expect(await storedState()).toBeNull()

    const first = await getPlanLimits()
    expect(first.phase).toBe('grace')
    expect(first.issues.map((i) => i.key)).toEqual(['maxBoards'])
    expect(first.since).toBe(now.toISOString())
    expect(first.graceEndsAt).toBe(graceEndFor(now).toISOString())
    expect(first.fromPlan).toBe('pro')
    expect(await storedState()).toMatchObject({
      since: now.toISOString(),
      graceEndsAt: graceEndFor(now).toISOString(),
    })
  })

  it('starts that fresh grace from the projection write too, never from the lapse', async () => {
    const now = new Date()
    vi.useFakeTimers({ toFake: ['Date'], now })
    const lapsed = lapsedProjection(new Date(now.getTime() - 30 * DAY))
    await configure({
      planBilling: true,
      tierLimits: null,
      cloud: { enabled: true, projection: lapsed },
    })
    expect(await storedState()).toBeNull()

    await detectPlanLimitsAfterProjectionWrite(lapsed, now)
    expect(await storedState()).toMatchObject({
      since: now.toISOString(),
      graceEndsAt: graceEndFor(now).toISOString(),
      fromPlan: 'pro',
    })
  })

  it('writes the state only over the value it read', async () => {
    const a = { since: 'a' }
    expect(await compareAndSetPlanLimitsState(null, a)).toBe(true)
    expect(await compareAndSetPlanLimitsState(null, { since: 'b' })).toBe(false)
    expect(await storedState()).toEqual(a)
    expect(await compareAndSetPlanLimitsState(a, null)).toBe(true)
    expect(await storedState()).toBeNull()
  })

  it("takes the other process's grace when it loses the race to store one", async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    // Another process stores its grace after this one read the settings.
    spies.readsNoState = true
    const theirs = {
      since: '2026-11-01T00:00:00.000Z',
      graceEndsAt: '2026-11-08T00:00:00.000Z',
      fromPlan: 'pro',
      fromFeatures: {},
      // The same limits this process reads: the race is over the same drop.
      limitsKey: limitsKeyFor(
        'free',
        mergeTierLimits(FREE_LIKE),
        planFeatureSet(
          mergeTierLimits(FREE_LIKE).features,
          resolveCloudConfig(planBillingOn() as never)
        )
      ),
    }
    await testDb
      .update(settings)
      .set({ planLimitsState: theirs as never })
      .where(eq(settings.id, settingsId))
    const limits = await getPlanLimits()
    spies.readsNoState = false
    expect(limits.since).toBe(theirs.since)
    expect(limits.fromPlan).toBe('pro')
    expect(await storedState()).toEqual(theirs)
  })

  it('leaves the grace and its choices alone without plan billing', async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    const first = await getPlanLimits()
    expect(await setKeptBoard(small)).toEqual({ ok: true })
    await configure({ planBilling: false, tierLimits: FREE_LIKE })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await storedState()).toMatchObject({ since: first.since, keptBoardId: small })
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    const back = await getPlanLimits()
    expect(back.since).toBe(first.since)
    expect(back.keptBoardId).toBe(small)
  })

  it('bumps the limits revision on a tier limits write', async () => {
    const [before] = await testDb.select().from(settings).where(eq(settings.id, settingsId))
    await writeTierLimits({ maxBoards: 7 }, { writer: 'config' })
    const [after] = await testDb.select().from(settings).where(eq(settings.id, settingsId))
    expect(after!.authConfigVersion).toBe(before!.authConfigVersion + 1)
  })

  it('clears the state when the limits are lifted', async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    await getPlanLimits()
    expect(await storedState()).not.toBeNull()
    await configure({
      planBilling: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null, features: OSS_TIER_LIMITS.features },
    })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await storedState()).toBeNull()
  })

  it('lists a paid feature that is set up past the plan, and keeps it live through the grace only', async () => {
    await configure({ planBilling: true, tierLimits: { ...FREE_LIKE, maxBoards: null } })
    await testDb.insert(webhooks).values({
      url: 'https://example.com/hook',
      secret: 'acme-secret',
      events: ['post.created'],
      createdById: ownerId,
    } as never)
    await invalidatePlanLimits()
    // The plan before had webhooks; later reads know it from the stored grace.
    await detectPlanLimits({
      previous: {
        plan: 'pro',
        features: planFeatureSet(OSS_TIER_LIMITS.features, DISABLED_CLOUD_CONFIG),
      },
    })
    await invalidatePlanLimits()
    const limits = await getPlanLimits()
    expect(limits.featureIssues).toEqual([{ key: 'webhooks', count: 1 }])
    expect(limits.phase).toBe('grace')
    expect(await isFeatureLive('webhooks')).toBe(true)
    expect(await isFeaturePaused('webhooks')).toBe(false)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect(await isFeatureLive('webhooks')).toBe(false)
    expect(await isFeaturePaused('webhooks')).toBe(true)
  })

  it('reads an owner role assignment as the owner', async () => {
    await configure({
      planBilling: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null, maxTeamSeats: 0 },
    })
    const [ownerRole] = await testDb.select().from(roles).where(eq(roles.key, 'owner')).limit(1)
    // The migrations seed the Owner preset; without it this case would prove nothing.
    expect(ownerRole).toBeDefined()
    if (!ownerRole) return
    const uid = createId('user') as UserId
    const assigned = createId('principal') as PrincipalId
    await testDb
      .insert(user)
      .values({ id: uid, name: 'Acme Assigned', email: `${uid}@example.com` })
    await testDb
      .insert(principal)
      .values({ id: assigned, userId: uid, role: 'member', type: 'user', createdAt: new Date(0) })
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: assigned, roleId: ownerRole.id } as never)
    await invalidatePlanLimits()
    const { candidates } = await getPlanLimitsWithCandidates()
    expect(candidates.members?.find((m) => m.id === assigned)).toMatchObject({
      isOwner: true,
      canManageBilling: true,
    })
  })

  it('carries the replaced plan into the grace after a projection write', async () => {
    await configure({ planBilling: true, tierLimits: FREE_LIKE })
    const replaced = {
      version: 1,
      effectivePlan: 'pro',
      trialStartedAt: null,
      trialExpiresAt: null,
      subscriptionStatus: 'active',
      entitlements: { webhooks: true, customDomain: true },
      freeLimits: projectedLimits(1),
      planLimits: projectedLimits(null),
      planLimitsExpireAt: null,
      canUpgrade: true,
      canManageBilling: true,
      renewalAt: null,
      cancellationAt: null,
    }
    await detectPlanLimitsAfterProjectionWrite(replaced)
    const stored = await storedState()
    expect(stored?.fromPlan).toBe('pro')
  })
})

/**
 * Seats are counted and ranked over every team member in the database, and
 * other test files commit members while this one runs. These cases read one
 * snapshot (a repeatable read transaction) on a pinned clock, so the count,
 * the cap and the ranking all see the same people, and the members they add
 * are the newest there.
 */
describe.skipIf(!fixture.available)('seat ranking against one snapshot (real DB)', () => {
  const PINNED = new Date('2030-01-07T09:00:00.000Z')

  async function addSeat(name: string, createdAt: Date, lastSignIn: Date | null) {
    const uid = createId('user') as UserId
    const id = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: uid, name, email: `${uid}@example.com` })
    await testDb
      .insert(principal)
      .values({ id, userId: uid, role: 'member', type: 'user', createdAt })
    if (lastSignIn) await signIn(uid, lastSignIn)
    return { id, uid }
  }

  async function signIn(uid: UserId, at: Date) {
    await testDb.insert(session).values({
      id: createId('user'),
      token: createId('user'),
      userId: uid,
      createdAt: at,
      updatedAt: at,
      expiresAt: new Date(at.getTime() + 30 * DAY),
    } as never)
  }

  beforeEach(async () => {
    await fixture.begin()
    await testDb.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    vi.useFakeTimers({ toFake: ['Date'], now: PINNED })
    spies.cache.clear()
    spies.readsNoState = false
    settingsId = await ensureSettings()
    await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
    const uid = createId('user') as UserId
    ownerId = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: uid, name: 'Acme Owner', email: `${uid}@example.com` })
    await testDb
      .insert(principal)
      .values({ id: ownerId, userId: uid, role: 'admin', type: 'user', createdAt: new Date(0) })
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  // Members this file adds are the newest in the database, whatever other
  // files have left committed, so the ones over the cap are always theirs.
  let newest = Date.parse('2100-01-01T00:00:00.000Z')
  async function addMember(name: string, lastSignIn: Date | null): Promise<PrincipalId> {
    newest += DAY
    return (await addSeat(name, new Date(newest), lastSignIn)).id
  }

  it('pauses only members without a seat after the grace, never the owner', async () => {
    const memberId = await addMember('Acme Member', null)
    // One seat over, whatever else the database holds.
    const { used } = await countSeatUsage()
    await configure({
      planBilling: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null, maxTeamSeats: used - 1 },
    })
    await invalidatePlanLimits()
    const { limits, candidates } = await getPlanLimitsWithCandidates()
    expect(limits.issues.map((i) => i.key)).toEqual(['maxTeamSeats'])
    const owner = candidates.members?.find((m) => m.id === ownerId)
    expect(owner).toMatchObject({ isOwner: true, canManageBilling: true })
    expect(candidates.members?.find((m) => m.id === memberId)).toMatchObject({
      isOwner: false,
      canManageBilling: false,
    })
    expect(await isSeatPaused(memberId)).toBe(false)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect(await isSeatPaused(memberId)).toBe(true)
    expect(await isSeatPaused(ownerId)).toBe(false)
    // Choosing every member is more seats than the plan has.
    const everyone = candidates.members!.map((m) => m.id)
    expect(await setSeatHolders(everyone)).toEqual({ ok: false, reason: 'too_many' })
    // Someone who is not a seat (a service principal behind a key) is never paused.
    expect(await isSeatPaused(createId('principal'))).toBe(false)
  })

  it('shows the fix at once when a member is removed through the member service', async () => {
    const memberId = await addMember('Acme Member', null)
    // One seat over, whatever else the database holds.
    const { used } = await countSeatUsage()
    await configure({
      planBilling: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null, maxTeamSeats: used - 1 },
    })
    await invalidatePlanLimits()
    await getPlanLimits()
    expect((await getPlanLimits()).issues.map((i) => i.key)).toEqual(['maxTeamSeats'])
    await removeTeamMember(memberId, ownerId, null, undefined, { granterRole: 'admin' })
    const [row] = await testDb.select().from(principal).where(eq(principal.id, memberId))
    expect(row?.role).toBe('user')
    expect((await getPlanLimits()).issues).toEqual([])
  })

  it('keeps the admin a seat when nobody holds the owner role or billing rights', async (ctx) => {
    // As a seeded workspace leaves it: the admin holds the Admin role, which
    // cannot manage billing, and no one holds Owner.
    const [adminRole] = await testDb.select().from(roles).where(eq(roles.key, 'admin')).limit(1)
    if (!adminRole) ctx.skip()
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: ownerId, roleId: adminRole!.id } as never)
    const active = await addMember('Acme Active', new Date(Date.now() - DAY))
    const { used } = await countSeatUsage()
    await configure({
      planBilling: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null, maxTeamSeats: used - 1 },
    })
    await invalidatePlanLimits()
    const { candidates } = await getPlanLimitsWithCandidates()
    const admin = candidates.members?.find((m) => m.id === ownerId)
    expect(admin).toMatchObject({ isOwner: false, canManageBilling: false, isAdmin: true })
    // Other test files can leave owners or admins committed; the rule is only
    // observable without them.
    const others = (candidates.members ?? []).filter((m) => m.id !== ownerId && m.id !== active)
    if (others.some((m) => m.isOwner || m.canManageBilling || m.isAdmin)) ctx.skip()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect(await isSeatPaused(ownerId)).toBe(false)
    // The guarantee holds for a choice too: the admin plus the cap is too many.
    expect(await setSeatHolders(candidates.members!.map((m) => m.id))).toEqual({
      ok: false,
      reason: 'too_many',
    })
  })

  it('ranks seats on activity before the grace ended, so signing in later takes no seat', async () => {
    const earlier = await addSeat('Acme Earlier', PINNED, new Date(PINNED.getTime() - 2 * DAY))
    // Newest of all, without activity: the two seats over the cap.
    const later = await addSeat('Acme Later', new Date('2100-01-01T00:00:00.000Z'), null)
    const unrelated = await addSeat('Acme Unrelated', new Date('2100-01-02T00:00:00.000Z'), null)
    const { used } = await countSeatUsage()
    await configure({
      planBilling: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null, maxTeamSeats: used - 2 },
    })
    const start = await getPlanLimits()
    expect(start.phase).toBe('grace')
    expect(start.issues.find((i) => i.key === 'maxTeamSeats')).toMatchObject({ used })

    // After the grace, the member without a seat signs in.
    vi.setSystemTime(Date.parse(start.graceEndsAt!) + DAY)
    await signIn(later.uid, new Date())
    await invalidatePlanLimits()
    expect(await isSeatPaused(earlier.id)).toBe(false)
    expect(await isSeatPaused(later.id)).toBe(true)
    expect(await isSeatPaused(unrelated.id)).toBe(true)
  })
})

/**
 * Single sign-on set up on a plan without it: it keeps working through the
 * grace and falls back to email links only once paused. The workspace
 * settings read asks for it, and plan limits read the settings, so the read
 * must not wait on itself.
 */
describe.skipIf(!fixture.available)('single sign-on through the grace (real DB)', () => {
  const NO_SSO = {
    ...OSS_TIER_LIMITS,
    features: { ...OSS_TIER_LIMITS.features, customOidcProvider: false },
  }

  beforeEach(async () => {
    await fixture.begin()
    vi.useRealTimers()
    spies.cache.clear()
    settingsId = await ensureSettings()
    await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb.delete(identityProvider)
    await testDb.insert(identityProvider).values({
      registrationId: 'acme-sso',
      label: 'Acme SSO',
      clientId: 'acme-client',
      enabled: true,
    } as never)
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  const settled = <T>(work: Promise<T>) =>
    Promise.race([
      work,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('the settings read waited on itself')), 5000)
      ),
    ])

  it('keeps a provider set up before the drop signing in until the grace ends', async () => {
    await configure({ planBilling: true, tierLimits: NO_SSO })
    const workspace = await settled(getWorkspaceSettings())
    expect(workspace?.ssoProvidersConfigured).toBe(true)
    expect(await isSsoLive()).toBe(true)
    const state = await storedState()
    expect((state?.fromFeatures as Record<string, boolean>).sso).toBe(true)

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    await invalidatePlanLimits()
    expect(await isSsoLive()).toBe(false)
    await settled(getWorkspaceSettings())
  })

  it('is the plan alone without plan billing', async () => {
    await configure({ planBilling: false, tierLimits: NO_SSO })
    expect(await isSsoLive()).toBe(false)
    await configure({ planBilling: false, tierLimits: { ...OSS_TIER_LIMITS } })
    expect(await isSsoLive()).toBe(true)
    expect(await storedState()).toBeNull()
  })
})

describe.skipIf(!fixture.available)('detection on a billing projection write (real DB)', () => {
  const instance = process.env.QUACKBACK_INSTANCE_ID
  beforeEach(async () => {
    await fixture.begin()
    spies.cache.clear()
    process.env.QUACKBACK_INSTANCE_ID = 'ws_acme'
    settingsId = await ensureSettings()
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    const uid = createId('user') as UserId
    ownerId = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: uid, name: 'Acme Owner', email: `${uid}@example.com` })
    await testDb
      .insert(principal)
      .values({ id: ownerId, userId: uid, role: 'admin', type: 'user', createdAt: new Date() })
    await addBoard('Acme one', 0, new Date('2026-01-01T00:00:00.000Z'))
    await addBoard('Acme two', 0, new Date('2026-02-01T00:00:00.000Z'))
    const pro = projection(1, 'pro', null, { webhooks: true })
    await configure({
      planBilling: true,
      tierLimits: null,
      cloud: { enabled: true, projection: pro },
    })
    await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
  })
  afterEach(async () => {
    if (instance === undefined) delete process.env.QUACKBACK_INSTANCE_ID
    else process.env.QUACKBACK_INSTANCE_ID = instance
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('fills in the replaced plan when a read stored the grace first', async () => {
    const appliedAt = new Date(Date.now() - 1000)
    const free = parseBillingProjection(projection(2, 'free', 1, {}))!
    await configure({
      planBilling: true,
      tierLimits: null,
      cloud: { enabled: true, projection: free },
    })
    // A read races the projection write and stores the grace without the old plan.
    const raced = await getPlanLimits()
    expect((await storedState())?.fromPlan).toBeNull()
    await detectPlanLimitsAfterProjectionWrite(
      projection(1, 'pro', null, { webhooks: true }),
      appliedAt
    )
    const stored = await storedState()
    expect(stored).toMatchObject({ since: raced.since, fromPlan: 'pro' })
    expect((stored?.fromFeatures as Record<string, boolean>).webhooks).toBe(true)
  })

  it('never rewrites the plan of a grace from before the projection write', async () => {
    const free = parseBillingProjection(projection(2, 'free', 1, {}))!
    await configure({
      planBilling: true,
      tierLimits: null,
      cloud: { enabled: true, projection: free },
    })
    await getPlanLimits()
    const later = new Date(Date.now() + 1000)
    await detectPlanLimitsAfterProjectionWrite(
      projection(1, 'pro', null, { webhooks: true }),
      later
    )
    expect((await storedState())?.fromPlan).toBeNull()
  })

  it('starts the grace when the new projection drops the plan, carrying the old plan', async () => {
    const free = parseBillingProjection(projection(2, 'free', 1, {}))!
    await writeBillingProjection('ws_acme', free)
    const stored = await storedState()
    expect(stored).toMatchObject({ fromPlan: 'pro' })
    expect((stored?.fromFeatures as Record<string, boolean>).webhooks).toBe(true)
  })
})

function projection(
  version: number,
  plan: string,
  maxBoards: number | null,
  entitlements: Record<string, boolean>
) {
  return {
    version,
    effectivePlan: plan,
    trialStartedAt: null,
    trialExpiresAt: null,
    subscriptionStatus: plan === 'free' ? null : 'active',
    entitlements,
    freeLimits: projectedLimits(1),
    planLimits: projectedLimits(maxBoards),
    planLimitsExpireAt: null,
    canUpgrade: true,
    canManageBilling: true,
    renewalAt: null,
    cancellationAt: null,
  }
}

function projectedLimits(boards: number | null) {
  return {
    maxBoards: boards,
    maxPosts: null,
    maxTeamSeats: null,
    maxStatusComponents: null,
    maxCustomRoles: null,
    maxSendingDomains: null,
    aiTokensPerMonth: null,
    emailsPerMonth: null,
    apiRequestsPerMonth: null,
    apiRequestsPerMinute: null,
    maxInboundEmailAddresses: null,
    maxHelpCenterLocales: null,
    maxStatusSubscribers: null,
  }
}

/** A Pro term that lapsed at `at`: Free's one board from then on. */
function lapsedProjection(at: Date) {
  return {
    ...projection(1, 'pro', null, { webhooks: true }),
    planLimitsExpireAt: at.toISOString(),
  }
}
