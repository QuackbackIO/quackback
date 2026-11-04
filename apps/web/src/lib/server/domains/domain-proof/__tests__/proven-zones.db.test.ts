/**
 * Proven zones against a real database, rolled back after each test.
 *
 * A workspace's database is its world: each workspace on a fleet has its own.
 * So "another workspace's rows never count" is the statement that a proof
 * seeded in one world is gone in the next, with nothing carried between them
 * by the process.
 *
 * The TXT lookup is a fake zone that answers only for the names it publishes
 * and records every name it is asked about, so "verified with no lookup" and
 * "fell back to the record" are both observable.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { emailSendingDomains, settings, ssoVerifiedDomain, teams } from '@/lib/server/db'
import type { SendingDomainDnsRecord } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const zone = vi.hoisted(() => ({
  published: new Map<string, string[]>(),
  asked: [] as string[],
  through: [] as unknown[],
}))
vi.mock('@/lib/server/dns/resolver', () => ({
  systemResolver: { kind: 'background' },
  interactiveResolver: { kind: 'interactive' },
}))
vi.mock('@/lib/server/auth/dns-verify', () => ({
  lookupVerificationTxt: async (name: string, resolver: unknown) => {
    zone.asked.push(name)
    zone.through.push(resolver)
    const values = zone.published.get(name)
    return values ? { ok: true, values } : { ok: false, reason: 'no-record' }
  },
}))

import { getProvenZones, ssoDomainProvenBy } from '../proven-zones'
import { checkSsoDomainOwnership } from '../sso-domain-check'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailSendingDomains.dkimMode }).from(emailSendingDomains).limit(0)
    await db.select({ id: ssoVerifiedDomain.id }).from(ssoVerifiedDomain).limit(0)
    await db.select({ c: settings.cloudIdentity }).from(settings).limit(0)
  },
})

const OWNERSHIP: SendingDomainDnsRecord = {
  type: 'TXT',
  host: '_quackback',
  value: 'quackback-domain-verification=6f1c2a9e4b8d0f37',
  purpose: 'ownership',
}
const SIGNING_KEY: SendingDomainDnsRecord = {
  type: 'TXT',
  host: 'qb._domainkey',
  value: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1L7VLPHCgcVA',
  purpose: 'dkim',
}
const PROVIDER_CNAME: SendingDomainDnsRecord = {
  type: 'CNAME',
  host: 'abc._domainkey',
  value: 'abc.dkim.provider.example',
  purpose: 'dkim',
}

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${suffix()}` })
    .returning()
  return team.id
}

/**
 * A sending-domain row in a given state, written directly. The only app writer
 * of `verified` is the checker, so the state a verification leaves behind is
 * set up here rather than through a helper production code could reach.
 */
async function seedSendingDomain(
  domain: string,
  opts: {
    status?: 'pending' | 'verified' | 'failed'
    dkimMode?: 'easy' | 'byo' | 'shared'
    dnsRecords?: SendingDomainDnsRecord[]
  } = {}
): Promise<void> {
  const status = opts.status ?? 'verified'
  await testDb.insert(emailSendingDomains).values({
    owningTeamId: await seedTeam(),
    domain,
    status,
    dkimMode: opts.dkimMode ?? 'easy',
    verifiedAt: status === 'verified' ? new Date() : null,
    dnsRecords: opts.dnsRecords ?? [OWNERSHIP, PROVIDER_CNAME],
  })
}

async function seedSsoDomain(name: string, verified: boolean) {
  const [row] = await testDb
    .insert(ssoVerifiedDomain)
    .values({
      name,
      verificationToken: `tok${suffix()}`,
      verifiedAt: verified ? new Date() : null,
    })
    .returning()
  return row
}

async function seedOperatorHostnames(
  hostnames: { hostname: string; readiness: 'pending' | 'ready' | 'failed' }[]
): Promise<void> {
  const at = '2026-10-01T12:00:00.000Z'
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: `acme-${suffix()}`,
    createdAt: new Date(),
    cloudIdentity: {
      version: 1,
      displayName: 'Acme',
      canonicalOrigin: 'https://acme.example.com',
      platformHostname: 'acme.example.com',
      customDomains: hostnames.map((h, i) => ({ ...h, isPrimary: i === 0, updatedAt: at })),
      updatedAt: at,
    },
  })
}

describe.skipIf(!fixture.available)('proven zones (real DB, rolled back)', () => {
  beforeEach(async () => {
    zone.published.clear()
    zone.asked.length = 0
    zone.through.length = 0
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('getProvenZones', () => {
    it('lists each kind of proof with its source', async () => {
      await seedSendingDomain('acme.com')
      await seedSendingDomain('signed.example.com', { dkimMode: 'byo', dnsRecords: [SIGNING_KEY] })
      await seedSsoDomain('example.org', true)
      await seedOperatorHostnames([{ hostname: 'feedback.example.net', readiness: 'ready' }])

      const zones = await getProvenZones()
      expect(zones).toEqual(
        expect.arrayContaining([
          {
            zone: 'acme.com',
            source: 'email-sending',
            exact: false,
            record: { name: '_quackback.acme.com', value: OWNERSHIP.value },
          },
          {
            zone: 'signed.example.com',
            source: 'email-sending',
            exact: false,
            record: { name: 'qb._domainkey.signed.example.com', value: SIGNING_KEY.value },
          },
          { zone: 'feedback.example.net', source: 'web-address', exact: true, record: null },
        ])
      )
      expect(zones).toHaveLength(3)
    })

    it('adds verified single sign-on domains only when asked to', async () => {
      const sso = await seedSsoDomain('Example.ORG', true)
      await seedSsoDomain('pending.example.org', false)

      expect(await getProvenZones()).toEqual([])
      expect(await getProvenZones({ includeSso: true })).toEqual([
        {
          zone: 'example.org',
          source: 'sso',
          exact: false,
          record: {
            name: '_quackback-verify.example.org',
            value: `qb-domain-verify=${sso.verificationToken}`,
          },
        },
      ])
    })

    it('leaves out pending and failed sending rows', async () => {
      await seedSendingDomain('pending.example.com', { status: 'pending' })
      await seedSendingDomain('failed.example.com', { status: 'failed' })
      expect(await getProvenZones()).toEqual([])
    })

    it('leaves out a verified row that carries none of its own proof', async () => {
      // On the provider's keys with only the CNAMEs everyone publishes.
      await seedSendingDomain('nocheck.example.com', { dnsRecords: [PROVIDER_CNAME] })
      // Brought its own key but holds only an ownership token, which a
      // byo row is not verified by.
      await seedSendingDomain('byo.example.com', { dkimMode: 'byo', dnsRecords: [OWNERSHIP] })
      // Over an identity that already existed: proven by its own key, never by
      // the provider's CNAMEs or a token it is not verified with.
      await seedSendingDomain('shared.example.com', {
        dkimMode: 'shared',
        dnsRecords: [OWNERSHIP, PROVIDER_CNAME],
      })
      expect(await getProvenZones()).toEqual([])
    })

    it('counts a verified shared-identity row by its own key', async () => {
      await seedSendingDomain('shared.example.com', {
        dkimMode: 'shared',
        dnsRecords: [SIGNING_KEY, PROVIDER_CNAME],
      })
      expect(await getProvenZones()).toEqual([
        {
          zone: 'shared.example.com',
          source: 'email-sending',
          exact: false,
          record: { name: 'qb._domainkey.shared.example.com', value: SIGNING_KEY.value },
        },
      ])
    })

    it('leaves out pending SSO domains and operator hostnames that are not ready', async () => {
      await seedSsoDomain('pending.example.org', false)
      await seedOperatorHostnames([
        { hostname: 'pending.example.net', readiness: 'pending' },
        { hostname: 'failed.example.net', readiness: 'failed' },
      ])
      expect(await getProvenZones({ includeSso: true })).toEqual([])
    })
  })

  describe('single sign-on domain check', () => {
    it('verifies the same domain through a verified sending domain, with no lookup', async () => {
      await seedSendingDomain('acme.com')
      const sso = await seedSsoDomain('acme.com', false)

      expect(await checkSsoDomainOwnership(sso)).toEqual({ ok: true, via: 'email-sending' })
      expect(zone.asked).toEqual([])
    })

    it('verifies a subdomain through a verified sending domain above it', async () => {
      await seedSendingDomain('acme.com')
      const sso = await seedSsoDomain('eu.acme.com', false)

      expect(await checkSsoDomainOwnership(sso)).toEqual({ ok: true, via: 'email-sending' })
      expect(zone.asked).toEqual([])
    })

    it('never verifies a parent through a sending domain on its subdomain', async () => {
      await seedSendingDomain('sub.acme.com')
      const sso = await seedSsoDomain('acme.com', false)

      expect(await ssoDomainProvenBy('acme.com')).toBeNull()
      expect(await checkSsoDomainOwnership(sso)).toEqual({ ok: false, reason: 'no-record' })
      expect(zone.asked).toEqual(['_quackback-verify.acme.com'])
    })

    it('never counts a pending or failed sending domain', async () => {
      await seedSendingDomain('acme.com', { status: 'pending' })
      await seedSendingDomain('acme.org', { status: 'failed' })

      expect(await ssoDomainProvenBy('acme.com')).toBeNull()
      expect(await ssoDomainProvenBy('acme.org')).toBeNull()
      const sso = await seedSsoDomain('acme.com', false)
      expect(await checkSsoDomainOwnership(sso)).toEqual({ ok: false, reason: 'no-record' })
    })

    it('does not treat a name that merely ends the same way as a subdomain', async () => {
      await seedSendingDomain('acme.com')
      expect(await ssoDomainProvenBy('notacme.com')).toBeNull()
    })

    it('does not verify through another single sign-on domain', async () => {
      await seedSsoDomain('acme.com', true)
      const sso = await seedSsoDomain('eu.acme.com', false)

      expect(await checkSsoDomainOwnership(sso)).toEqual({ ok: false, reason: 'no-record' })
      expect(zone.asked).toEqual(['_quackback-verify.eu.acme.com'])
    })

    it('verifies through a ready web address for that exact name only', async () => {
      await seedOperatorHostnames([{ hostname: 'feedback.acme.com', readiness: 'ready' }])

      expect(await ssoDomainProvenBy('feedback.acme.com')).toBe('web-address')
      expect(await ssoDomainProvenBy('eu.feedback.acme.com')).toBeNull()
      expect(await ssoDomainProvenBy('acme.com')).toBeNull()
    })

    it("never counts another workspace's rows", async () => {
      // Workspace A's world holds the proof.
      await seedSendingDomain('acme.com')
      expect(await ssoDomainProvenBy('acme.com')).toBe('email-sending')

      // Workspace B's world: the same process, a database without that row.
      await fixture.rollback()
      await fixture.begin()
      const sso = await seedSsoDomain('acme.com', false)
      expect(await ssoDomainProvenBy('acme.com')).toBeNull()
      expect(await checkSsoDomainOwnership(sso)).toEqual({ ok: false, reason: 'no-record' })
    })

    it('still verifies by its own TXT record when nothing covers it', async () => {
      const sso = await seedSsoDomain('acme.com', false)
      zone.published.set('_quackback-verify.acme.com', [
        `qb-domain-verify=${sso.verificationToken}`,
      ])
      expect(await checkSsoDomainOwnership(sso)).toEqual({ ok: true, via: 'dns' })
      // Someone clicked Verify and is waiting: the lookup gets a second try.
      expect(zone.through).toEqual([{ kind: 'interactive' }])

      zone.published.set('_quackback-verify.acme.com', ['qb-domain-verify=someone-else'])
      expect(await checkSsoDomainOwnership(sso)).toEqual({ ok: false, reason: 'mismatch' })
    })
  })
})
