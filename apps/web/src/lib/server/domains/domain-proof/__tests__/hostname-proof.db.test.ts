/**
 * The proof sent with an operator-managed hostname, against a real database
 * rolled back after each test.
 *
 * A workspace's database is its world, so "another workspace's rows never
 * count" is the statement that a proof seeded in one world is gone in the next.
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

import { getHostnameProof, hostnameProofFrom } from '../hostname-proof'
import type { ProvenZone } from '../proven-zones'

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
  host: 'qb2048._domainkey',
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

async function seedSendingDomain(
  domain: string,
  opts: {
    status?: 'pending' | 'verified' | 'failed'
    dkimMode?: 'easy' | 'byo' | 'shared'
    dnsRecords?: SendingDomainDnsRecord[]
  } = {}
): Promise<void> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${suffix()}` })
    .returning()
  const status = opts.status ?? 'verified'
  await testDb.insert(emailSendingDomains).values({
    owningTeamId: team.id as TeamId,
    domain,
    status,
    dkimMode: opts.dkimMode ?? 'easy',
    verifiedAt: status === 'verified' ? new Date() : null,
    dnsRecords: opts.dnsRecords ?? [OWNERSHIP, PROVIDER_CNAME],
  })
}

async function seedSsoDomain(name: string, verified = true) {
  const [row] = await testDb
    .insert(ssoVerifiedDomain)
    .values({ name, verificationToken: `tok${suffix()}`, verifiedAt: verified ? new Date() : null })
    .returning()
  return row
}

async function seedReadyHostname(hostname: string): Promise<void> {
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
      customDomains: [{ hostname, readiness: 'ready', isPrimary: true, updatedAt: at }],
      updatedAt: at,
    },
  })
}

describe.skipIf(!fixture.available)('hostname proof (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("sends a sending domain's own key record for a hostname under it", async () => {
    await seedSendingDomain('acme.com', { dkimMode: 'byo', dnsRecords: [SIGNING_KEY] })
    expect(await getHostnameProof('Feedback.Acme.com.')).toEqual({
      source: 'email-sending',
      zone: 'acme.com',
      record: { name: 'qb2048._domainkey.acme.com', value: SIGNING_KEY.value },
    })
  })

  it("sends a provider-keyed sending domain's ownership token", async () => {
    await seedSendingDomain('acme.com')
    expect(await getHostnameProof('acme.com')).toEqual({
      source: 'email-sending',
      zone: 'acme.com',
      record: { name: '_quackback.acme.com', value: OWNERSHIP.value },
    })
  })

  it("sends a verified sign-in domain's verification record", async () => {
    const sso = await seedSsoDomain('acme.com')
    expect(await getHostnameProof('feedback.acme.com')).toEqual({
      source: 'sso',
      zone: 'acme.com',
      record: {
        name: '_quackback-verify.acme.com',
        value: `qb-domain-verify=${sso.verificationToken}`,
      },
    })
  })

  it('chooses the most specific zone that covers the hostname', async () => {
    await seedSsoDomain('acme.com')
    await seedSendingDomain('help.acme.com')
    await seedSsoDomain('eu.help.acme.com')

    expect(await getHostnameProof('feedback.help.acme.com')).toMatchObject({
      source: 'email-sending',
      zone: 'help.acme.com',
    })
    expect(await getHostnameProof('portal.eu.help.acme.com')).toMatchObject({
      source: 'sso',
      zone: 'eu.help.acme.com',
    })
  })

  it('never proves a parent of a proven zone, or a name that only ends the same way', async () => {
    await seedSendingDomain('feedback.acme.com')
    await seedSsoDomain('eu.acme.com')
    expect(await getHostnameProof('acme.com')).toBeNull()
    expect(await getHostnameProof('notfeedback.acme.com')).toBeNull()
  })

  it('never counts a web address, which is what is being proven', async () => {
    await seedReadyHostname('feedback.acme.com')
    expect(await getHostnameProof('feedback.acme.com')).toBeNull()
  })

  it('never counts a sending domain that is not verified or has lost its proof', async () => {
    await seedSendingDomain('pending.example.com', { status: 'pending' })
    await seedSendingDomain('failed.example.com', { status: 'failed' })
    await seedSendingDomain('nocheck.example.com', { dnsRecords: [PROVIDER_CNAME] })
    await seedSsoDomain('unverified.example.com', false)
    for (const name of [
      'feedback.pending.example.com',
      'feedback.failed.example.com',
      'feedback.nocheck.example.com',
      'feedback.unverified.example.com',
    ]) {
      expect(await getHostnameProof(name)).toBeNull()
    }
  })

  it("never counts another workspace's rows", async () => {
    await seedSendingDomain('acme.com')
    expect(await getHostnameProof('feedback.acme.com')).not.toBeNull()

    // Another workspace's world: the same process, a database without that row.
    await fixture.rollback()
    await fixture.begin()
    expect(await getHostnameProof('feedback.acme.com')).toBeNull()
  })
})

describe('hostnameProofFrom', () => {
  const record = (name: string) => ({ name, value: `v-${name}` })
  const zones: ProvenZone[] = [
    { zone: 'acme.com', source: 'sso', exact: false, record: record('sso') },
    { zone: 'acme.com', source: 'email-sending', exact: false, record: record('mail') },
  ]

  it('prefers email sending over single sign-on for the same zone, in any order', () => {
    expect(hostnameProofFrom('feedback.acme.com', zones)?.source).toBe('email-sending')
    expect(hostnameProofFrom('feedback.acme.com', [...zones].reverse())?.source).toBe(
      'email-sending'
    )
  })

  it('refuses an unusable hostname', () => {
    expect(hostnameProofFrom('  ', zones)).toBeNull()
  })
})
