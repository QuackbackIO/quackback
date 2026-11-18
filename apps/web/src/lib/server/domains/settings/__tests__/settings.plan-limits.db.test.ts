/**
 * The section hostnames the plan limits read (the custom domain in use, and
 * the hosts a paused custom domain keeps serving), against a real database
 * rolled back after each test. They are the section map every reader uses:
 * the help center's own domain before the map is first written, the map once
 * it is, and never the primary domain.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheGet: async () => null,
  cacheSet: async () => {},
  cacheDel: async () => {},
}))
vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  getBaseUrl: () => 'https://feedback.acme.com',
}))

const { readPlanLimitsSources } = await import('../settings.plan-limits')
const { invalidateSettingsCache } = await import('../settings.helpers')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ c: settings.planLimitsState }).from(settings).limit(0)
  },
})

const NOW = '2026-11-01T00:00:00.000Z'
const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seed(values: Partial<typeof settings.$inferInsert>) {
  await testDb.delete(settings)
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${suffix()}`, createdAt: new Date(), ...values })
  await invalidateSettingsCache()
}

const legacyHelp = (domain: string) =>
  JSON.stringify({ enabled: true, domain: { domain, verifiedAt: NOW } })
const portal = (sectionDomains: Record<string, { hostname: string; verifiedAt: string | null }>) =>
  JSON.stringify({ sectionDomains })

describe.skipIf(!fixture.available)('plan limits section hostnames (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("reads the help center's own domain before the section map is written", async () => {
    await seed({ helpCenterConfig: legacyHelp('help.acme.com') })
    expect((await readPlanLimitsSources())?.sectionHostnames).toEqual(['help.acme.com'])
  })

  it('reads every section in the map, verified or not, and not a help domain the map replaced', async () => {
    await seed({
      helpCenterConfig: legacyHelp('old-help.acme.com'),
      portalConfig: portal({
        help: { hostname: 'help.acme.com', verifiedAt: NOW },
        status: { hostname: 'status.acme.com', verifiedAt: null },
      }),
    })
    expect((await readPlanLimitsSources())?.sectionHostnames).toEqual([
      'help.acme.com',
      'status.acme.com',
    ])
  })

  it('leaves out a section that names the primary domain', async () => {
    await seed({
      portalConfig: portal({ help: { hostname: 'feedback.acme.com', verifiedAt: NOW } }),
    })
    expect((await readPlanLimitsSources())?.sectionHostnames).toEqual([])
  })
})
