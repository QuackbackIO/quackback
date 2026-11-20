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
  // The shared tier is off; this process's copies are still forgotten.
  cacheDel: async (...keys: string[]) =>
    (await import('@/lib/server/local-cache')).forgetCachedKeys(...keys),
}))
vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  configuredBaseUrl: () => 'https://feedback.acme.com',
  getBaseUrl: () => 'https://feedback.acme.com',
}))

const { readCustomHostnames, readPlanLimitsSources } = await import('../settings.plan-limits')
const { deriveFromSettingsCached, invalidateSettingsCache } = await import('../settings.helpers')
const { runWithLogContext } = await import('@/lib/server/log-context')

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

  it('reads every custom hostname, from the identity projection and the section map', async () => {
    await seed({
      cloudIdentity: {
        version: 1,
        displayName: 'Acme',
        canonicalOrigin: 'https://feedback.acme.com',
        platformHostname: 'acme.example.com',
        customDomains: [
          { hostname: 'feedback.acme.com', readiness: 'ready', isPrimary: true, updatedAt: NOW },
        ],
        updatedAt: NOW,
      },
      portalConfig: portal({ status: { hostname: 'status.acme.com', verifiedAt: null } }),
    })
    expect([...(await readCustomHostnames())]).toEqual(['feedback.acme.com', 'status.acme.com'])
  })

  it('reads no custom hostname when none is set up', async () => {
    await seed({})
    expect((await readCustomHostnames()).size).toBe(0)
  })

  it('derives once per copy of the settings, and again after a write', async () => {
    await seed({ portalConfig: portal({ help: { hostname: 'help.acme.com', verifiedAt: NOW } }) })
    const derive = vi.fn((row: { name: string }) => row.name)
    await runWithLogContext({} as never, async () => {
      expect(await deriveFromSettingsCached('name', derive)).toBe('Acme')
      expect(await deriveFromSettingsCached('name', derive)).toBe('Acme')
      expect(derive).toHaveBeenCalledTimes(1)
      // A settings write drops the request's copy.
      await testDb.update(settings).set({ name: 'Acme Two' })
      await invalidateSettingsCache()
      expect(await deriveFromSettingsCached('name', derive)).toBe('Acme Two')
      expect(derive).toHaveBeenCalledTimes(2)
    })
  })

  it('reads the sources once per request', async () => {
    await seed({ helpCenterConfig: legacyHelp('help.acme.com') })
    await runWithLogContext({} as never, async () => {
      const first = await readPlanLimitsSources()
      expect(await readPlanLimitsSources()).toBe(first)
    })
  })
})
