/**
 * Team and channels after the plan limits grace, the edges around each hook,
 * against a real database: the exact end of the grace, the seat chooser and the
 * seat guarantee, coming back on an upgrade or a fix with nothing deleted, an
 * install without plan billing, and a failed plan limits read (every hook
 * fails open, and a send never fails).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type PrincipalId,
  type RoleId,
  type StatusComponentId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  emailSendingDomains,
  eq,
  inArray,
  isNull,
  permissions,
  principal,
  rolePermissions,
  roles,
  settings,
  statusComponents,
  user,
} from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { DEFAULT_HELP_CENTER_CONFIG } from '@/lib/server/domains/settings/settings.types'

const usage = vi.hoisted(() => ({ fail: false }))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// The usage count is the plan limits read that touches the database; a failed
// count is how a plan limits read fails in practice.
vi.mock('@/lib/server/domains/billing/usage-counts', async (original) => {
  const real = await original<typeof import('@/lib/server/domains/billing/usage-counts')>()
  return {
    ...real,
    loadUsageCounts: async (...args: Parameters<typeof real.loadUsageCounts>) => {
      if (usage.fail) throw new Error('usage count failed')
      return real.loadUsageCounts(...args)
    },
  }
})

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { updateRole } from '@/lib/server/domains/roles/role.service'
import {
  getPlanLimits,
  invalidatePlanLimits,
  visibleStatusComponentIds,
} from '../plan-limits.service'
import { setSeatHolders } from '../plan-limits.choosers'
import { isPausedTeamSeat } from '../plan-limits.seats'
import { heldHelpCenterLocales } from '../plan-limits.locales'
import { markPresent, readAvailableAgentIds } from '@/lib/server/realtime/presence'
import { planBillingOn } from './plan-billing'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

/** No caps but the ones a case sets. */
const UNCAPPED = {
  ...OSS_TIER_LIMITS,
  maxBoards: null,
  maxTeamSeats: null,
  maxCustomRoles: null,
  maxSendingDomains: null,
  maxHelpCenterLocales: null,
  maxStatusComponents: null,
}

let ownerId: PrincipalId

/** `planBilling` off is an install without plan billing. */
async function configure(planBilling: boolean, tierLimits: object) {
  await testDb.update(settings).set({
    cloud: (planBilling ? planBillingOn() : null) as never,
    tierLimits: JSON.stringify(tierLimits),
  })
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
}

async function enforce(caps: Record<string, number>) {
  await configure(true, { ...UNCAPPED, ...caps })
  await getPlanLimits()
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
  await invalidatePlanLimits()
  expect((await getPlanLimits()).phase).toBe('enforced')
}

async function addPerson(name: string, role: 'admin' | 'member', at = 0): Promise<PrincipalId> {
  const uid = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: uid, name, email: `${uid}@example.com` })
  await testDb
    .insert(principal)
    .values({ id, userId: uid, role, type: 'user', createdAt: new Date(at) })
  return id
}

async function addRole(name: string, keys: string[]): Promise<RoleId> {
  const id = createId('role') as RoleId
  await testDb.insert(roles).values({ id, key: id, name, isSystem: false })
  const rows = await testDb
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.key, keys))
  await testDb.insert(rolePermissions).values(rows.map((p) => ({ roleId: id, permissionId: p.id })))
  return id
}

const paused = (id: PrincipalId, role: 'admin' | 'member' = 'member') =>
  isPausedTeamSeat({ id, role, type: 'user' })

async function addComponents(names: string[]): Promise<StatusComponentId[]> {
  const ids: StatusComponentId[] = []
  for (const [position, name] of names.entries()) {
    const [row] = await testDb
      .insert(statusComponents)
      .values({ name, position, showUptime: true, status: 'operational' })
      .returning({ id: statusComponents.id })
    ids.push(row!.id as StatusComponentId)
  }
  return ids
}

async function setLanguages(additional: string[]) {
  await testDb.update(settings).set({
    helpCenterConfig: JSON.stringify({
      ...DEFAULT_HELP_CENTER_CONFIG,
      locales: { default: 'en', additional, chrome: {} },
    }),
  })
  await invalidateSettingsCache()
}

beforeEach(async () => {
  await fixture.begin()
  vi.useRealTimers()
  usage.fail = false
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (!row) {
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
  }
  await testDb.update(settings).set({ planLimitsState: null })
  await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
  await testDb
    .update(principal)
    .set({ role: 'user' })
    .where(inArray(principal.role, ['admin', 'member']))
  await testDb.delete(roles).where(eq(roles.isSystem, false))
  await testDb.delete(emailSendingDomains)
  await testDb
    .update(statusComponents)
    .set({ deletedAt: new Date() })
    .where(isNull(statusComponents.deletedAt))
  ownerId = await addPerson('Acme Owner', 'admin')
})
afterEach(async () => {
  vi.useRealTimers()
  usage.fail = false
  await invalidatePlanLimits()
  await fixture.rollback()
})

describe.skipIf(!fixture.available)('the end of the grace (real DB)', () => {
  it('pauses a seat at the instant graceEndsAt and not a millisecond before', async () => {
    const member = await addPerson('Acme Member', 'member')
    await configure(true, { ...UNCAPPED, maxTeamSeats: 1 })
    const end = Date.parse((await getPlanLimits()).graceEndsAt!)
    vi.useFakeTimers({ toFake: ['Date'], now: end - 1 })
    await invalidatePlanLimits()
    expect(await paused(member)).toBe(false)
    vi.setSystemTime(end)
    await invalidatePlanLimits()
    expect(await paused(member)).toBe(true)
  })
})

describe.skipIf(!fixture.available)('who keeps a seat (real DB)', () => {
  it('honours the chosen seat holder over the default', async () => {
    // By default the more recently active member keeps the second seat.
    const older = await addPerson('Acme Older', 'member', 1000)
    const newer = await addPerson('Acme Newer', 'member', 2000)
    await configure(true, { ...UNCAPPED, maxTeamSeats: 2 })
    expect(await setSeatHolders([older])).toEqual({ ok: true })
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    await invalidatePlanLimits()
    expect(await paused(older)).toBe(false)
    expect(await paused(newer)).toBe(true)
    expect(await paused(ownerId, 'admin')).toBe(false)
  })

  it('never pauses the owner, even when the stored choice leaves them out', async () => {
    const member = await addPerson('Acme Member', 'member')
    await configure(true, { ...UNCAPPED, maxTeamSeats: 1 })
    await getPlanLimits()
    // A choice written before the owner changed: it names only the member.
    const [row] = await testDb.select({ state: settings.planLimitsState }).from(settings)
    const state = typeof row!.state === 'string' ? JSON.parse(row!.state) : row!.state
    await testDb
      .update(settings)
      .set({ planLimitsState: JSON.stringify({ ...state, seatHolderIds: [member] }) as never })
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    await invalidatePlanLimits()
    // The owner holds billing rights, so the owner's seat is the one the cap keeps.
    expect(await paused(ownerId, 'admin')).toBe(false)
    expect(await paused(member)).toBe(true)
  })
})

describe.skipIf(!fixture.available)('coming back (real DB)', () => {
  it('restores every hook at once on an upgrade, with nothing deleted', async () => {
    const member = await addPerson('Acme Member', 'member')
    const custom = await addRole('Acme Support', ['member.view'])
    const components = await addComponents(['Acme API', 'Acme Web'])
    await setLanguages(['fr', 'de'])
    await enforce({
      maxTeamSeats: 1,
      maxCustomRoles: 0,
      maxHelpCenterLocales: 2,
      maxStatusComponents: 1,
    })
    const editor = { principalId: ownerId, permissions: ['member.view'] as never }
    expect(await paused(member)).toBe(true)
    await expect(updateRole(custom, { name: 'Acme Locked' }, editor)).rejects.toMatchObject({
      code: 'CUSTOM_ROLES_LOCKED',
    })
    expect(await heldHelpCenterLocales()).toEqual(['de'])
    expect(await visibleStatusComponentIds()).toEqual([components[0]])

    await configure(true, UNCAPPED)
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await paused(member)).toBe(false)
    await expect(updateRole(custom, { name: 'Acme Open' }, editor)).resolves.toMatchObject({
      name: 'Acme Open',
    })
    expect(await heldHelpCenterLocales()).toEqual([])
    expect(await visibleStatusComponentIds()).toBeNull()
    const kept = await testDb
      .select({ id: statusComponents.id })
      .from(statusComponents)
      .where(inArray(statusComponents.id, components))
    expect(kept).toHaveLength(2)
  })

  it('unpauses a seat as soon as another member leaves the team', async () => {
    const leaving = await addPerson('Acme Leaving', 'member', 2000)
    const staying = await addPerson('Acme Staying', 'member', 1000)
    await enforce({ maxTeamSeats: 2 })
    expect([await paused(leaving), await paused(staying)]).toContain(true)
    await testDb.update(principal).set({ role: 'user' }).where(eq(principal.id, leaving))
    await invalidatePlanLimits()
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await paused(staying)).toBe(false)
  })
})

describe.skipIf(!fixture.available)('an install without plan billing (real DB)', () => {
  it('never pauses, locks or hides anything, however far over the tier limits caps', async () => {
    const member = await addPerson('Acme Member', 'member')
    await addComponents(['Acme API', 'Acme Web', 'Acme Docs', 'Acme Mail'])
    await setLanguages(['fr', 'de', 'es', 'it'])
    await configure(false, {
      ...UNCAPPED,
      maxTeamSeats: 1,
      maxHelpCenterLocales: 1,
      maxStatusComponents: 1,
    })
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 30 * DAY })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await paused(member)).toBe(false)
    expect(await heldHelpCenterLocales()).toEqual([])
    expect(await visibleStatusComponentIds()).toBeNull()
    const [row] = await testDb.select({ state: settings.planLimitsState }).from(settings)
    expect(row?.state ?? null).toBeNull()
  })
})

describe.skipIf(!fixture.available)('a failed plan limits read (real DB)', () => {
  it('fails open for every hook', async () => {
    const member = await addPerson('Acme Member', 'member')
    const custom = await addRole('Acme Support', ['member.view'])
    await addComponents(['Acme API', 'Acme Web'])
    await setLanguages(['fr', 'de'])
    await enforce({
      maxTeamSeats: 1,
      maxCustomRoles: 0,
      maxHelpCenterLocales: 2,
      maxStatusComponents: 1,
    })
    expect(await paused(member)).toBe(true)
    usage.fail = true
    await invalidatePlanLimits()
    await expect(getPlanLimits()).rejects.toThrow('usage count failed')
    expect(await paused(member)).toBe(false)
    expect(await heldHelpCenterLocales()).toEqual([])
    expect(await visibleStatusComponentIds()).toBeNull()
    const editor = { principalId: ownerId, permissions: ['member.view'] as never }
    await expect(updateRole(custom, { name: 'Acme Open' }, editor)).resolves.toMatchObject({
      name: 'Acme Open',
    })
  })
})

describe.skipIf(!fixture.available)('the new-message alert availability (real DB)', () => {
  it('never counts a paused seat with a live inbox as available, and only once enforced', async () => {
    const member = await addPerson('Acme Member', 'member')
    await markPresent(ownerId, `stream-${ownerId}`, true)
    await markPresent(member, `stream-${member}`, true)
    await configure(true, { ...UNCAPPED, maxTeamSeats: 1 })
    expect((await readAvailableAgentIds())?.sort()).toEqual([ownerId, member].sort())
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    await invalidatePlanLimits()
    expect(await readAvailableAgentIds()).toEqual([ownerId])
  })
})
