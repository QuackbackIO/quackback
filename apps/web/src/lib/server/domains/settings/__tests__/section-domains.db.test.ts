/**
 * Setting a portal section's hostname, against a real database rolled back
 * after each test: the map is written whole, one hostname serves one section,
 * a Cloud hostname must be one of the workspace's custom domains, and the help
 * center's own domain moves into the map on the first write.
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
const side = vi.hoisted(() => ({
  ensured: [] as string[],
  entitled: true,
  status: { dnsResolved: true, instanceReachable: true, verified: true },
  dnsAnswered: true,
}))
vi.mock('@/lib/server/domains/domain-proof/ensure-domain', () => ({
  ensureDomainForCustomDomain: async (hostname: string) => {
    side.ensured.push(hostname)
  },
}))
vi.mock('@/lib/server/domains/settings/cloud/entitlements', () => ({
  hasEntitlement: async () => side.entitled,
  requireEntitlement: async () => {},
}))
vi.mock('@/lib/server/domains/domain-proof/reachability-probe', () => ({
  probeCustomDomain: async () => ({ status: side.status, dnsAnswered: side.dnsAnswered }),
}))

const { getSectionDomains, setSectionDomain, verifySectionDomain } =
  await import('../section-domains.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ c: settings.cloudIdentity }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const NOW = '2026-11-01T00:00:00.000Z'

async function seedSettings(values: Partial<typeof settings.$inferInsert> = {}) {
  await testDb.delete(settings)
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${suffix()}`, createdAt: new Date(), ...values })
}

function cloudIdentity(
  domains: Array<{ hostname: string; readiness: string; isPrimary?: boolean }>
) {
  return {
    version: 1,
    displayName: 'Acme',
    canonicalOrigin: 'https://acme.example.com',
    platformHostname: 'acme.example.com',
    customDomains: domains.map((d) => ({
      hostname: d.hostname,
      readiness: d.readiness,
      isPrimary: d.isPrimary ?? false,
      updatedAt: NOW,
    })),
    updatedAt: NOW,
  } as typeof settings.$inferInsert.cloudIdentity
}

async function stored() {
  const [row] = await testDb
    .select({ portal: settings.portalConfig, hc: settings.helpCenterConfig })
    .from(settings)
    .limit(1)
  const portal = row?.portal ? JSON.parse(row.portal) : null
  const hc = row?.hc ? JSON.parse(row.hc) : null
  return { sectionDomains: portal?.sectionDomains, helpDomain: hc?.domain ?? null }
}

const legacyHelp = (domain: string, verifiedAt: string | null) =>
  JSON.stringify({ enabled: true, domain: { domain, verifiedAt } })

describe.skipIf(!fixture.available)('section domains (real DB, rolled back)', () => {
  beforeEach(async () => {
    side.ensured = []
    side.entitled = true
    side.status = { dnsResolved: true, instanceReachable: true, verified: true }
    side.dnsAnswered = true
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('self-hosted', () => {
    beforeEach(() => seedSettings())

    it('reads the help center domain until the map is first written', async () => {
      await seedSettings({ helpCenterConfig: legacyHelp('help.acme.com', NOW) })
      expect(await getSectionDomains()).toEqual({
        help: { hostname: 'help.acme.com', verifiedAt: NOW },
      })
    })

    it('sets a section, normalised and not yet verified, and puts it on Settings > Domains', async () => {
      const result = await setSectionDomain('status', 'Status.Acme.com.')

      expect(result).toEqual({
        ok: true,
        sectionDomains: { status: { hostname: 'status.acme.com', verifiedAt: null } },
      })
      expect((await stored()).sectionDomains).toEqual({
        status: { hostname: 'status.acme.com', verifiedAt: null },
      })
      expect(side.ensured).toEqual(['status.acme.com'])
    })

    it('moves the help center domain into the map on the first write', async () => {
      await seedSettings({ helpCenterConfig: legacyHelp('help.acme.com', NOW) })
      await setSectionDomain('status', 'status.acme.com')

      expect((await stored()).sectionDomains).toEqual({
        help: { hostname: 'help.acme.com', verifiedAt: NOW },
        status: { hostname: 'status.acme.com', verifiedAt: null },
      })
    })

    it('clears a section from the map, and it stays cleared', async () => {
      await seedSettings({ helpCenterConfig: legacyHelp('help.acme.com', NOW) })
      await setSectionDomain('status', 'status.acme.com')
      const result = await setSectionDomain('help', null)

      expect(result).toEqual({
        ok: true,
        sectionDomains: { status: { hostname: 'status.acme.com', verifiedAt: null } },
      })
      expect(await getSectionDomains()).toEqual({
        status: { hostname: 'status.acme.com', verifiedAt: null },
      })
      expect((await stored()).helpDomain).toEqual({ domain: null, verifiedAt: null })
    })

    it("keeps the help center's own setting in step for one release", async () => {
      await setSectionDomain('help', 'help.acme.com')
      expect((await stored()).helpDomain).toEqual({ domain: 'help.acme.com', verifiedAt: null })
    })

    it('keeps the verification of a hostname set again unchanged', async () => {
      await seedSettings({ helpCenterConfig: legacyHelp('help.acme.com', NOW) })
      await setSectionDomain('help', 'HELP.acme.com')
      expect((await getSectionDomains()).help).toEqual({
        hostname: 'help.acme.com',
        verifiedAt: NOW,
      })
    })

    it('refuses a hostname another section uses, and writes nothing', async () => {
      await setSectionDomain('status', 'status.acme.com')
      side.ensured = []
      const result = await setSectionDomain('help', 'status.acme.com')

      expect(result).toMatchObject({ ok: false, code: 'SECTION_DOMAIN_TAKEN' })
      expect((await stored()).sectionDomains).toEqual({
        status: { hostname: 'status.acme.com', verifiedAt: null },
      })
      expect(side.ensured).toEqual([])
    })

    it('refuses a hostname that is not a public domain name', async () => {
      for (const input of ['not a host', 'localhost', '10.0.0.1', 'help.acme.test']) {
        expect(await setSectionDomain('help', input)).toMatchObject({
          ok: false,
          code: 'SECTION_DOMAIN_INVALID',
        })
      }
      expect((await stored()).sectionDomains).toBeUndefined()
    })

    it('verifies a section when its hostname resolves and this server answers on it', async () => {
      await setSectionDomain('status', 'status.acme.com')
      const result = await verifySectionDomain('status')

      expect(result.ok).toBe(true)
      const entry = (await getSectionDomains()).status
      expect(entry?.hostname).toBe('status.acme.com')
      expect(entry?.verifiedAt).toEqual(expect.any(String))
    })

    it('takes the verification away when the hostname stops answering', async () => {
      await seedSettings({ helpCenterConfig: legacyHelp('help.acme.com', NOW) })
      side.status = { dnsResolved: true, instanceReachable: false, verified: false }
      await verifySectionDomain('help')

      expect((await getSectionDomains()).help).toEqual({
        hostname: 'help.acme.com',
        verifiedAt: null,
      })
      expect((await stored()).helpDomain).toEqual({ domain: 'help.acme.com', verifiedAt: null })
    })

    it('keeps a verification when the lookup goes unanswered', async () => {
      await seedSettings({ helpCenterConfig: legacyHelp('help.acme.com', NOW) })
      side.status = { dnsResolved: false, instanceReachable: false, verified: false }
      side.dnsAnswered = false
      await verifySectionDomain('help')

      // Kept, but marked as unconfirmed: sign-in is not carried to it.
      expect((await getSectionDomains()).help).toEqual({
        hostname: 'help.acme.com',
        verifiedAt: NOW,
        unconfirmedSince: expect.any(String),
      })
    })

    it('keeps the first unconfirmed time across checks, so the grace has an end', async () => {
      await seedSettings({ helpCenterConfig: legacyHelp('help.acme.com', NOW) })
      side.status = { dnsResolved: false, instanceReachable: false, verified: false }
      side.dnsAnswered = false
      await verifySectionDomain('help')
      const first = (await getSectionDomains()).help?.unconfirmedSince
      expect(first).toEqual(expect.any(String))
      await verifySectionDomain('help')
      expect((await getSectionDomains()).help?.unconfirmedSince).toBe(first)
    })

    it('clears the unconfirmed mark once the hostname answers again', async () => {
      await seedSettings({ helpCenterConfig: legacyHelp('help.acme.com', NOW) })
      side.status = { dnsResolved: false, instanceReachable: false, verified: false }
      side.dnsAnswered = false
      await verifySectionDomain('help')
      side.status = { dnsResolved: true, instanceReachable: true, verified: true }
      side.dnsAnswered = true
      await verifySectionDomain('help')
      const entry = (await getSectionDomains()).help
      expect(entry?.verifiedAt).toEqual(expect.any(String))
      expect(entry && 'unconfirmedSince' in entry).toBe(false)
    })

    it('does not verify a never-verified hostname whose lookup goes unanswered', async () => {
      await setSectionDomain('status', 'status.acme.com')
      side.status = { dnsResolved: false, instanceReachable: false, verified: false }
      side.dnsAnswered = false
      await verifySectionDomain('status')

      expect((await getSectionDomains()).status?.verifiedAt).toBeNull()
    })

    it('refuses to verify a section with no hostname', async () => {
      expect(await verifySectionDomain('status')).toMatchObject({
        ok: false,
        code: 'SECTION_DOMAIN_NOT_SET',
      })
    })
  })

  describe('Cloud', () => {
    beforeEach(() =>
      seedSettings({
        cloud: { enabled: true } as typeof settings.$inferInsert.cloud,
        cloudIdentity: cloudIdentity([
          { hostname: 'acme.com', readiness: 'ready', isPrimary: true },
          { hostname: 'help.acme.com', readiness: 'ready' },
          { hostname: 'status.acme.com', readiness: 'pending' },
        ]),
      })
    )

    it('takes a ready custom domain as verified', async () => {
      const result = await setSectionDomain('help', 'help.acme.com')
      expect(result.ok).toBe(true)
      expect((await getSectionDomains()).help?.verifiedAt).toEqual(expect.any(String))
      expect(side.ensured).toEqual(['help.acme.com'])
    })

    it('takes a custom domain still being set up as not yet verified', async () => {
      await setSectionDomain('status', 'status.acme.com')
      expect((await getSectionDomains()).status).toEqual({
        hostname: 'status.acme.com',
        verifiedAt: null,
      })
    })

    it("refuses a hostname that is not one of the workspace's custom domains", async () => {
      expect(await setSectionDomain('help', 'docs.acme.com')).toMatchObject({
        ok: false,
        code: 'SECTION_DOMAIN_NOT_CUSTOM',
      })
      expect((await stored()).sectionDomains).toBeUndefined()
    })

    it('refuses the primary domain, which serves the whole portal', async () => {
      expect(await setSectionDomain('help', 'acme.com')).toMatchObject({
        ok: false,
        code: 'SECTION_DOMAIN_PRIMARY',
      })
    })

    it('refuses a new hostname without the custom domain entitlement, but still clears one', async () => {
      await setSectionDomain('help', 'help.acme.com')
      side.entitled = false
      expect(await setSectionDomain('status', 'status.acme.com')).toMatchObject({
        ok: false,
        code: 'SECTION_DOMAIN_NOT_ENTITLED',
      })
      expect(await setSectionDomain('help', null)).toMatchObject({ ok: true })
    })

    it("leaves the help center's own setting alone, which Cloud never uses", async () => {
      await setSectionDomain('help', 'help.acme.com')
      expect((await stored()).helpDomain).toBeNull()
    })

    it('verifies from the custom domain readiness', async () => {
      await setSectionDomain('status', 'status.acme.com')
      await testDb.update(settings).set({
        cloudIdentity: cloudIdentity([
          { hostname: 'acme.com', readiness: 'ready', isPrimary: true },
          { hostname: 'status.acme.com', readiness: 'ready' },
        ]),
      })
      expect((await verifySectionDomain('status')).ok).toBe(true)
      expect((await getSectionDomains()).status?.verifiedAt).toEqual(expect.any(String))
    })
  })
})
