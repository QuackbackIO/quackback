/**
 * The plan limits state against a real database: detection on read, the
 * stored state, the cache and its invalidation, the choosers, and the flag.
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
  isNull,
  posts,
  principal,
  principalRoleAssignments,
  roles,
  session,
  settings,
  statusComponents,
  user,
  webhooks,
} from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

const spies = vi.hoisted(() => ({ loadUsageCounts: vi.fn(), readsNoState: false }))

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
vi.mock('@/lib/server/domains/billing/usage-counts', async (original) => {
  const real = await original<typeof import('@/lib/server/domains/billing/usage-counts')>()
  spies.loadUsageCounts.mockImplementation(real.loadUsageCounts)
  return { ...real, loadUsageCounts: spies.loadUsageCounts }
})

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { updateFeatureFlags } from '@/lib/server/domains/settings/settings.service'
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
import { DISABLED_CLOUD_CONFIG } from '@/lib/server/domains/settings/cloud/cloud.types'
import { planFeatureSet } from '../plan-limits.features'
import { limitsKeyFor } from '../plan-limits.rules'
import { writeTierLimits } from '@/lib/server/domains/settings/tier-limits.write'
import { compareAndSetPlanLimitsState } from '@/lib/server/domains/settings/settings.plan-limits'
import {
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

async function configure(options: {
  planLimits: boolean
  tierLimits?: Record<string, unknown> | null
  cloud?: unknown
}) {
  await testDb
    .update(settings)
    .set({
      featureFlags: JSON.stringify({ feedback: true, planLimits: options.planLimits }),
      tierLimits: options.tierLimits === null ? null : JSON.stringify(options.tierLimits ?? {}),
      cloud: (options.cloud ?? null) as never,
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

  it('is ok and stores nothing with the flag off, without counting anything', async () => {
    await configure({ planLimits: false, tierLimits: FREE_LIKE })
    const limits = await getPlanLimits()
    expect(limits.phase).toBe('ok')
    expect(limits.issues).toEqual([])
    expect(await storedState()).toBeNull()
    expect(spies.loadUsageCounts).not.toHaveBeenCalled()
    expect(await isBoardOpen(small)).toBe(true)
    expect(await isFeaturePaused('webhooks')).toBe(false)
    // Today's plan gate answer: the plan does not have webhooks.
    expect(await isFeatureLive('webhooks')).toBe(false)
  })

  it('detects as soon as the flag is turned on', async () => {
    await configure({ planLimits: false, tierLimits: FREE_LIKE })
    await updateFeatureFlags({ planLimits: true })
    expect(await storedState()).toMatchObject({ since: expect.any(String) })
  })

  it('is ok without counting anything when nothing is capped', async () => {
    await configure({ planLimits: true, tierLimits: null })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(spies.loadUsageCounts).not.toHaveBeenCalled()
    expect(await storedState()).toBeNull()
  })

  it('starts the grace on first detection and stores it once', async () => {
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
    const first = await getPlanLimits()
    expect(first.phase).toBe('grace')
    expect(first.issues.map((i) => [i.key, i.used, i.cap])).toEqual([['maxBoards', 2, 1]])
    const stored = await storedState()
    expect(stored).toMatchObject({ since: first.since, graceEndsAt: first.graceEndsAt })
    expect(Date.parse(first.graceEndsAt!) - Date.parse(first.since!)).toBe(7 * DAY)

    const again = await getPlanLimits(new Date(Date.now() + DAY))
    expect(again.since).toBe(first.since)
    expect(await isBoardOpen(small)).toBe(true)
  })

  it('freezes the boards past the cap after the grace, keeping the one with most posts', async () => {
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
    await getPlanLimits()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect((await getPlanLimits()).phase).toBe('enforced')
    expect(await openBoardIds()).toEqual([big])
    expect(await isBoardOpen(big)).toBe(true)
    expect(await isBoardOpen(small)).toBe(false)
  })

  it("keeps the admin's chosen board and refuses one that does not exist", async () => {
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
    expect(await setKeptBoard(createId('board'))).toEqual({ ok: false, reason: 'unknown' })
    expect(await setKeptBoard(small)).toEqual({ ok: true })
    expect((await storedState())?.keptBoardId).toBe(small)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    expect(await isBoardOpen(small)).toBe(true)
    expect(await isBoardOpen(big)).toBe(false)
  })

  it('refuses a choice for a cap that is not over', async () => {
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
    expect(await setSeatHolders([ownerId])).toEqual({ ok: false, reason: 'not_over' })
  })

  it('serves the cached count until a counted resource changes, then shows the fix at once', async () => {
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
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
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
    await getPlanLimits()
    expect((await getPlanLimits()).phase).toBe('grace')
    await deleteBoard(small)
    expect((await getPlanLimits()).phase).toBe('ok')
  })

  it('shows the fix at once when a status component is deleted', async () => {
    await configure({
      planLimits: true,
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
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
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
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
    const first = await getPlanLimits()
    expect(first.phase).toBe('grace')
    // Another process still holds the limits from before the drop.
    const freeRow = (await testDb.select().from(settings).where(eq(settings.id, settingsId)))[0]!
    await testDb.update(settings).set({ tierLimits: null }).where(eq(settings.id, settingsId))
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

  it('writes the state only over the value it read', async () => {
    const a = { since: 'a' }
    expect(await compareAndSetPlanLimitsState(null, a)).toBe(true)
    expect(await compareAndSetPlanLimitsState(null, { since: 'b' })).toBe(false)
    expect(await storedState()).toEqual(a)
    expect(await compareAndSetPlanLimitsState(a, null)).toBe(true)
    expect(await storedState()).toBeNull()
  })

  it("takes the other process's grace when it loses the race to store one", async () => {
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
    // Another process stores its grace after this one read the settings.
    spies.readsNoState = true
    const theirs = {
      since: '2026-11-01T00:00:00.000Z',
      graceEndsAt: '2026-11-08T00:00:00.000Z',
      fromPlan: 'pro',
      fromFeatures: {},
      // The same limits this process reads: the race is over the same drop.
      limitsKey: limitsKeyFor(
        null,
        mergeTierLimits(FREE_LIKE),
        planFeatureSet(mergeTierLimits(FREE_LIKE).features, DISABLED_CLOUD_CONFIG)
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

  it('leaves the grace and its choices alone while the flag is off', async () => {
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
    const first = await getPlanLimits()
    expect(await setKeptBoard(small)).toEqual({ ok: true })
    await configure({ planLimits: false, tierLimits: FREE_LIKE })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await storedState()).toMatchObject({ since: first.since, keptBoardId: small })
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
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
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
    await getPlanLimits()
    expect(await storedState()).not.toBeNull()
    await configure({
      planLimits: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null, features: OSS_TIER_LIMITS.features },
    })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await storedState()).toBeNull()
  })

  it('lists a paid feature that is set up past the plan, and keeps it live through the grace only', async () => {
    await configure({ planLimits: true, tierLimits: { ...FREE_LIKE, maxBoards: null } })
    await testDb.insert(webhooks).values({
      url: 'https://example.com/hook',
      secret: 'acme-secret',
      events: ['post.created'],
      createdById: ownerId,
    } as never)
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

  it('pauses only members without a seat after the grace, never the owner', async () => {
    const memberId = await addMember('Acme Member', null)
    // One seat over, whatever else the database holds.
    const { used } = await countSeatUsage()
    await configure({
      planLimits: true,
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

  async function addMember(name: string, lastSignIn: Date | null): Promise<PrincipalId> {
    const uid = createId('user') as UserId
    const id = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: uid, name, email: `${uid}@example.com` })
    await testDb
      .insert(principal)
      .values({ id, userId: uid, role: 'member', type: 'user', createdAt: new Date() })
    if (lastSignIn) {
      await testDb.insert(session).values({
        id: createId('user'),
        token: createId('user'),
        userId: uid,
        createdAt: lastSignIn,
        updatedAt: lastSignIn,
        expiresAt: new Date(lastSignIn.getTime() + 30 * DAY),
      } as never)
    }
    return id
  }

  it('shows the fix at once when a member is removed through the member service', async () => {
    const memberId = await addMember('Acme Member', null)
    // One seat over, whatever else the database holds.
    const { used } = await countSeatUsage()
    await configure({
      planLimits: true,
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

  it('ranks seats on activity before the grace ended, so signing in later takes no seat', async () => {
    const earlier = await addMember('Acme Earlier', new Date(Date.now() - 2 * DAY))
    const later = await addMember('Acme Later', null)
    await addMember('Acme Unrelated', null)
    // Two seats over: the two newest members without recent activity.
    const { used } = await countSeatUsage()
    await configure({
      planLimits: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null, maxTeamSeats: used - 2 },
    })
    await invalidatePlanLimits()
    await getPlanLimits()
    // After the grace, a member without a seat signs in.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    const [laterRow] = await testDb.select().from(principal).where(eq(principal.id, later))
    await testDb.insert(session).values({
      id: createId('user'),
      token: createId('user'),
      userId: laterRow!.userId!,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + DAY),
    } as never)
    await invalidatePlanLimits()
    expect(await isSeatPaused(earlier)).toBe(false)
    expect(await isSeatPaused(later)).toBe(true)
  })

  it('reads an owner role assignment as the owner', async () => {
    await configure({
      planLimits: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null, maxTeamSeats: 0 },
    })
    const [ownerRole] = await testDb.select().from(roles).where(eq(roles.key, 'owner')).limit(1)
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
    await configure({ planLimits: true, tierLimits: FREE_LIKE })
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

describe.skipIf(!fixture.available)('detection on a billing projection write (real DB)', () => {
  const instance = process.env.QUACKBACK_INSTANCE_ID
  beforeEach(async () => {
    await fixture.begin()
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
      planLimits: true,
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
      planLimits: true,
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
      planLimits: true,
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
