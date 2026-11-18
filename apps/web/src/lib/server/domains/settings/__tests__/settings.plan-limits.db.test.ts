/**
 * The custom hostnames the plan limits count as in use, against a real
 * database rolled back after each test. They come from the section map every
 * reader uses (the help center's own domain before the map is first written,
 * the map once it is, never the primary domain), and only while routing
 * sends visitors there: verified, and the section on. Every hostname the map
 * names, verified or not, is read too.
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
  configuredBaseUrl: () => 'https://feedback.acme.com',
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
const HELP_ON = JSON.stringify({ feedback: true, helpCenter: true })
const portal = (sectionDomains: Record<string, { hostname: string; verifiedAt: string | null }>) =>
  JSON.stringify({ sectionDomains })

describe.skipIf(!fixture.available)('plan limits section hostnames (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("reads the help center's own domain before the section map is written", async () => {
    await seed({ helpCenterConfig: legacyHelp('help.acme.com'), featureFlags: HELP_ON })
    expect((await readPlanLimitsSources())?.liveCustomDomains).toEqual(['help.acme.com'])
  })

  it('reads verified sections in the map, not pending ones, nor a help domain the map replaced', async () => {
    await seed({
      featureFlags: JSON.stringify({ feedback: true, helpCenter: true, statusPage: true }),
      helpCenterConfig: legacyHelp('old-help.acme.com'),
      portalConfig: portal({
        help: { hostname: 'help.acme.com', verifiedAt: NOW },
        status: { hostname: 'status.acme.com', verifiedAt: null },
      }),
    })
    const sources = await readPlanLimitsSources()
    expect(sources?.liveCustomDomains).toEqual(['help.acme.com'])
    // Every hostname the map names, verified or not, for the hosts a paused domain keeps.
    expect(sources?.sectionHostnames).toEqual(['help.acme.com', 'status.acme.com'])
  })

  it('leaves out a verified section whose section is off', async () => {
    await seed({
      featureFlags: JSON.stringify({ feedback: true, helpCenter: false }),
      portalConfig: portal({ help: { hostname: 'help.acme.com', verifiedAt: NOW } }),
    })
    expect((await readPlanLimitsSources())?.liveCustomDomains).toEqual([])
  })

  it('leaves out a section that names the primary domain', async () => {
    await seed({
      featureFlags: HELP_ON,
      portalConfig: portal({ help: { hostname: 'feedback.acme.com', verifiedAt: NOW } }),
    })
    expect((await readPlanLimitsSources())?.liveCustomDomains).toEqual([])
    expect((await readPlanLimitsSources())?.sectionHostnames).toEqual([])
  })

  it('reads custom domains the identity projection reports ready, unless parked on a section that is off', async () => {
    const domain = (hostname: string, readiness: string, isPrimary = false) => ({
      hostname,
      readiness,
      isPrimary,
      updatedAt: NOW,
    })
    await seed({
      featureFlags: JSON.stringify({ feedback: true, helpCenter: false }),
      portalConfig: portal({ help: { hostname: 'help.acme.com', verifiedAt: NOW } }),
      cloudIdentity: {
        version: 1,
        displayName: 'Acme',
        canonicalOrigin: 'https://acme.example.com',
        platformHostname: 'acme.example.com',
        updatedAt: NOW,
        customDomains: [
          domain('ideas.acme.com', 'ready', true),
          domain('roadmap.acme.com', 'ready'),
          domain('soon.acme.com', 'pending'),
          domain('help.acme.com', 'ready'),
        ],
      } as never,
    })
    expect((await readPlanLimitsSources())?.liveCustomDomains.sort()).toEqual([
      'ideas.acme.com',
      'roadmap.acme.com',
    ])
  })
})
