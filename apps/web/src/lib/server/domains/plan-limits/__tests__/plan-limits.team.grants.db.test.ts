/**
 * Giving a custom role past the plan's cap, after the grace, against a real
 * database, on the paths the main team suite does not drive: a team invite
 * and a workspace API key. A new grant is refused once enforced and allowed in
 * the grace and without plan billing; keeping a key on the role it already has
 * (a rotate or rename) stays open.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type RoleId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  inArray,
  isNull,
  permissions,
  rolePermissions,
  roles,
  settings,
} from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { assertInviteGrant } from '@/lib/server/domains/principals/team-invitation'
import { resolveGrantableKeyRole } from '@/lib/server/domains/api-keys/workspace-key-role'
import { getPlanLimits, invalidatePlanLimits } from '../plan-limits.service'
import { planBillingOn } from './plan-billing'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

const GRANTER = { role: 'admin' as const, permissions: ['member.view'] as never }

/** `planBilling` off is an install without plan billing. */
async function configure(planBilling: boolean) {
  await testDb.update(settings).set({
    cloud: (planBilling ? planBillingOn() : null) as never,
    tierLimits: JSON.stringify({ ...OSS_TIER_LIMITS, maxCustomRoles: 0 }),
  })
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
  await getPlanLimits()
}

async function inEachPhase(check: (phase: 'off' | 'grace' | 'enforced') => Promise<void>) {
  await configure(false)
  await check('off')
  await configure(true)
  await check('grace')
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
  await invalidatePlanLimits()
  await check('enforced')
}

const codeOf = (run: () => Promise<unknown>) =>
  run().then(
    (value) => value,
    (e: { code?: string }) => e.code
  )

let custom: RoleId

beforeEach(async () => {
  await fixture.begin()
  vi.useRealTimers()
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (!row) {
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
  }
  await testDb.update(settings).set({ planLimitsState: null })
  await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
  await testDb.delete(roles).where(inArray(roles.isSystem, [false]))
  custom = createId('role') as RoleId
  await testDb
    .insert(roles)
    .values({ id: custom, key: custom, name: 'Acme Support', isSystem: false })
  const [perm] = await testDb
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.key, ['member.view']))
  await testDb.insert(rolePermissions).values({ roleId: custom, permissionId: perm!.id })
})
afterEach(async () => {
  vi.useRealTimers()
  await invalidatePlanLimits()
  await fixture.rollback()
})

describe.skipIf(!fixture.available)('giving a custom role past the cap (real DB)', () => {
  it('refuses a team invite with a custom role only once enforced', async () => {
    await inEachPhase(async (phase) => {
      const result = await codeOf(() => assertInviteGrant('member', custom, GRANTER))
      expect(result).toBe(phase === 'enforced' ? 'CUSTOM_ROLES_LOCKED' : 'Acme Support')
    })
  })

  it('refuses a workspace key a custom role it does not have, only once enforced', async () => {
    await inEachPhase(async (phase) => {
      const result = await codeOf(() =>
        resolveGrantableKeyRole(custom, GRANTER, { newGrant: true })
      )
      if (phase === 'enforced') expect(result).toBe('CUSTOM_ROLES_LOCKED')
      else expect(result).toMatchObject({ assignRoleId: custom })
      // A key that already has the role (rotate, rename) keeps it.
      expect(await resolveGrantableKeyRole(custom, GRANTER)).toMatchObject({
        assignRoleId: custom,
      })
    })
  })
})
