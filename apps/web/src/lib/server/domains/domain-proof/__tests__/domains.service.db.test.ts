/**
 * Domains added by name, against a real database rolled back after each test.
 *
 * The TXT lookup is a fake zone that answers only for the names it publishes
 * and records every name it is asked about, so "proven with no lookup" is
 * observable. The rate limit is a fake that refuses once told to.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import type { TeamId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  domains,
  emailSendingDomains,
  eq,
  settings,
  ssoVerifiedDomain,
  teams,
} from '@/lib/server/db'
import type { SendingDomainDnsRecord } from '@/lib/server/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const zone = vi.hoisted(() => ({
  published: new Map<string, string[]>(),
  failing: new Set<string>(),
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
    if (zone.failing.has(name)) return { ok: false, reason: 'lookup-failed' }
    const values = zone.published.get(name)
    return values ? { ok: true, values } : { ok: false, reason: 'no-record' }
  },
}))

const limiter = vi.hoisted(() => ({ refuse: false, keys: [] as string[] }))
vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvSetNx: async (key: string) => {
    limiter.keys.push(key)
    return !limiter.refuse
  },
}))

import {
  addDomain,
  checkDomainOwnership,
  discardUnusedDomain,
  domainUsesOf,
  ensureDomain,
  getDomain,
  listDomains,
  removeDomain,
} from '../domains.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: domains.ownershipToken }).from(domains).limit(0)
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

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${suffix()}` })
    .returning()
  return team.id
}

async function seedSendingDomain(domain: string, status: 'pending' | 'verified' = 'verified') {
  await testDb.insert(emailSendingDomains).values({
    owningTeamId: await seedTeam(),
    domain,
    status,
    dkimMode: 'easy',
    verifiedAt: status === 'verified' ? new Date() : null,
    dnsRecords: [OWNERSHIP],
  })
}

async function seedSettings(over: Partial<typeof settings.$inferInsert> = {}) {
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: `acme-${suffix()}`,
    createdAt: new Date(),
    ...over,
  })
}

const published = (name: string, token: string) =>
  zone.published.set(`_quackback.${name}`, [`quackback-domain-verification=${token}`])

describe.skipIf(!fixture.available)('domains added by name (real DB, rolled back)', () => {
  beforeEach(async () => {
    zone.published.clear()
    zone.failing.clear()
    zone.asked.length = 0
    zone.through.length = 0
    limiter.refuse = false
    limiter.keys.length = 0
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('addDomain', () => {
    it('stores the name in its one spelling, pending, with a token of its own', async () => {
      const row = await addDomain('  ACME.com. ')
      expect(row.name).toBe('acme.com')
      expect(row.status).toBe('pending')
      expect(row.verifiedAt).toBeNull()
      expect(row.ownershipToken).toMatch(/^[0-9a-f]{32}$/)
      expect(row.ownershipToken).not.toContain('acme')
    })

    it.each([
      ['an empty name', ''],
      ['a single label', 'localhost'],
      ['an address', 'help@acme.com'],
      ['a reserved name', 'acme.test'],
      ['an IP literal', '192.168.0.1'],
    ])('refuses %s with a typed error', async (_, input) => {
      await expect(addDomain(input)).rejects.toBeInstanceOf(ValidationError)
      expect(await testDb.select().from(domains)).toEqual([])
    })

    it('is idempotent: adding a name again returns the same row and token', async () => {
      const first = await addDomain('acme.com')
      const second = await addDomain('Acme.COM')
      expect(second.id).toBe(first.id)
      expect(second.ownershipToken).toBe(first.ownershipToken)
      expect(await testDb.select().from(domains)).toHaveLength(1)
    })

    it('mints a different token for every domain', async () => {
      const a = await addDomain('acme.com')
      const b = await addDomain('acme.io')
      expect(a.ownershipToken).not.toBe(b.ownershipToken)
    })

    it('stores an internationalised name in its A-label form', async () => {
      const row = await addDomain('bücher.de')
      expect(row.name).toBe('xn--bcher-kva.de')
    })
  })

  describe('ensureDomain', () => {
    it('creates the row for a new name, pending, with a token of its own', async () => {
      const ensured = await ensureDomain(' Acme.COM. ')
      expect(ensured?.created).toBe(true)
      expect(ensured?.domain).toMatchObject({ name: 'acme.com', status: 'pending' })
      expect(ensured?.domain.ownershipToken).toMatch(/^[0-9a-f]{32}$/)
      expect(await testDb.select().from(domains)).toHaveLength(1)
    })

    it("is idempotent, and never changes an existing row's token or status", async () => {
      const row = await addDomain('acme.com')
      await testDb
        .update(domains)
        .set({ status: 'verified', verifiedAt: new Date() })
        .where(eq(domains.id, row.id))

      const again = await ensureDomain('ACME.com')
      expect(again?.created).toBe(false)
      expect(again?.domain.id).toBe(row.id)
      expect(again?.domain.ownershipToken).toBe(row.ownershipToken)
      expect(again?.domain.status).toBe('verified')
      expect(await testDb.select().from(domains)).toHaveLength(1)
    })

    it('makes nothing of a name that is not a domain anyone can prove', async () => {
      expect(await ensureDomain('acme.test')).toBeNull()
      expect(await ensureDomain('192.168.0.1')).toBeNull()
      expect(await testDb.select().from(domains)).toEqual([])
    })
  })

  describe('discardUnusedDomain', () => {
    it('removes a pending domain no use holds', async () => {
      const row = await addDomain('acme.com')
      await discardUnusedDomain(row)
      expect(await getDomain('acme.com')).toBeNull()
    })

    it('keeps a domain a use holds, or one already verified', async () => {
      const held = await addDomain('acme.com')
      await seedSendingDomain('acme.com', 'pending')
      await discardUnusedDomain(held)
      expect(await getDomain('acme.com')).not.toBeNull()

      const verified = await addDomain('acme.io')
      await testDb.update(domains).set({ status: 'verified' }).where(eq(domains.id, verified.id))
      await discardUnusedDomain(verified)
      expect(await getDomain('acme.io')).not.toBeNull()
    })

    it('waits for the lock on the name that issuing its token takes', async () => {
      const row = await addDomain('acme.com')
      const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
      const side = postgres(url!, { max: 1, onnotice: () => {} })
      try {
        await side`SELECT pg_advisory_lock(hashtext(${'quackback:domain-token:acme.com'}))`
        let done = false
        const discarding = discardUnusedDomain(row).then(() => {
          done = true
        })
        await new Promise((r) => setTimeout(r, 300))
        expect(done).toBe(false)
        await side`SELECT pg_advisory_unlock(hashtext(${'quackback:domain-token:acme.com'}))`
        await discarding
        expect(await getDomain('acme.com')).toBeNull()
      } finally {
        await side.end()
      }
    })
  })

  describe('getDomain and listDomains', () => {
    it('reads a domain by any spelling of its name, and null when there is none', async () => {
      const row = await addDomain('acme.com')
      expect((await getDomain('ACME.com'))?.id).toBe(row.id)
      expect(await getDomain('acme.io')).toBeNull()
    })

    it('lists every domain by name', async () => {
      await addDomain('acme.io')
      await addDomain('acme.com')
      expect((await listDomains()).map((d) => d.name)).toEqual(['acme.com', 'acme.io'])
    })
  })

  describe('checkDomainOwnership', () => {
    it('verifies a domain whose own token is published, through the interactive resolver', async () => {
      const row = await addDomain('acme.com')
      published('acme.com', row.ownershipToken)

      expect(await checkDomainOwnership('acme.com')).toEqual({ ok: true, via: 'dns' })
      expect(zone.asked).toEqual(['_quackback.acme.com'])
      expect(zone.through).toEqual([{ kind: 'interactive' }])
      const after = await getDomain('acme.com')
      expect(after?.status).toBe('verified')
      expect(after?.verifiedAt).toBeInstanceOf(Date)
      expect(after?.lastCheckedAt).toBeInstanceOf(Date)
    })

    it("ends a verified domain's grace period and its warning together when the record is found", async () => {
      const row = await addDomain('acme.com')
      await testDb
        .update(domains)
        .set({
          status: 'verified',
          verifiedAt: new Date('2026-10-01T00:00:00Z'),
          ownershipMissingSince: new Date('2026-11-01T06:00:00Z'),
          ownershipWarningClaimedAt: new Date('2026-11-01T06:00:01Z'),
          ownershipWarningSentAt: new Date('2026-11-01T06:00:02Z'),
        })
        .where(eq(domains.id, row.id))
      published('acme.com', row.ownershipToken)

      expect(await checkDomainOwnership('acme.com')).toEqual({ ok: true, via: 'dns' })
      const after = await getDomain('acme.com')
      expect(after?.ownershipMissingSince).toBeNull()
      expect(after?.ownershipWarningClaimedAt).toBeNull()
      expect(after?.ownershipWarningSentAt).toBeNull()
    })

    it('stays pending when the record holds a different value', async () => {
      await addDomain('acme.com')
      // Another row's token, or a value copied from somewhere else, proves nothing.
      published('acme.com', 'someone-elses-token')
      expect(await checkDomainOwnership('acme.com')).toEqual({ ok: false, reason: 'mismatch' })
      const after = await getDomain('acme.com')
      expect(after?.status).toBe('pending')
      expect(after?.verifiedAt).toBeNull()
      expect(after?.lastCheckedAt).toBeInstanceOf(Date)
    })

    it('stays pending when there is no record', async () => {
      await addDomain('acme.com')
      expect(await checkDomainOwnership('acme.com')).toEqual({ ok: false, reason: 'no-record' })
      expect((await getDomain('acme.com'))?.status).toBe('pending')
    })

    it('stays pending when the lookup fails', async () => {
      await addDomain('acme.com')
      zone.failing.add('_quackback.acme.com')
      expect(await checkDomainOwnership('acme.com')).toEqual({
        ok: false,
        reason: 'lookup-failed',
      })
      expect((await getDomain('acme.com'))?.status).toBe('pending')
    })

    it('makes no lookup under a zone already proven, and stamps nothing', async () => {
      await seedSendingDomain('acme.com')
      await addDomain('help.acme.com')

      expect(await checkDomainOwnership('help.acme.com')).toEqual({
        ok: true,
        via: 'email-sending',
      })
      expect(zone.asked).toEqual([])
      // Worked out when read, never written: the row stays as it was.
      expect((await getDomain('help.acme.com'))?.status).toBe('pending')
    })

    it('checks a verified domain against its own record, never proving it by itself', async () => {
      const row = await addDomain('acme.com')
      published('acme.com', row.ownershipToken)
      await checkDomainOwnership('acme.com')
      await testDb
        .update(domains)
        .set({ ownershipMissingSince: new Date('2026-11-01T00:00:00Z') })
        .where(eq(domains.id, row.id))
      zone.asked.length = 0
      limiter.refuse = false

      // Its own zone lists it, but a re-check reads the record itself, and a
      // record found again ends the grace period the watch started.
      expect(await checkDomainOwnership('acme.com')).toEqual({ ok: true, via: 'dns' })
      expect(zone.asked).toEqual(['_quackback.acme.com'])
      expect((await getDomain('acme.com'))?.ownershipMissingSince).toBeNull()
    })

    it('makes no lookup for a name under a verified domain, and stamps nothing', async () => {
      const parent = await addDomain('acme.com')
      published('acme.com', parent.ownershipToken)
      await checkDomainOwnership('acme.com')
      await addDomain('help.acme.com')
      zone.asked.length = 0

      expect(await checkDomainOwnership('help.acme.com')).toEqual({ ok: true, via: 'domain' })
      expect(zone.asked).toEqual([])
      expect((await getDomain('help.acme.com'))?.status).toBe('pending')
    })

    it('reads its own record even when a sending row shares its token', async () => {
      const row = await addDomain('acme.com')
      await testDb
        .update(domains)
        .set({ status: 'verified', ownershipMissingSince: new Date('2026-11-01T00:00:00Z') })
        .where(eq(domains.id, row.id))
      await testDb.insert(emailSendingDomains).values({
        owningTeamId: await seedTeam(),
        domain: 'acme.com',
        status: 'verified',
        dkimMode: 'easy',
        verifiedAt: new Date(),
        dnsRecords: [
          {
            type: 'TXT',
            host: '_quackback',
            value: `quackback-domain-verification=${row.ownershipToken}`,
            purpose: 'ownership',
          },
        ],
      })

      expect(await checkDomainOwnership('acme.com')).toEqual({ ok: false, reason: 'no-record' })
      expect(zone.asked).toEqual(['_quackback.acme.com'])
    })

    it('is not proven by a pending sending domain at the same name', async () => {
      await seedSendingDomain('acme.com', 'pending')
      await addDomain('acme.com')
      expect(await checkDomainOwnership('acme.com')).toEqual({ ok: false, reason: 'no-record' })
      expect(zone.asked).toEqual(['_quackback.acme.com'])
    })

    it('refuses a name that has not been added', async () => {
      await expect(checkDomainOwnership('acme.com')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('is rate-limited per domain', async () => {
      const row = await addDomain('acme.com')
      limiter.refuse = true
      await expect(checkDomainOwnership('acme.com')).rejects.toBeInstanceOf(ConflictError)
      expect(zone.asked).toEqual([])
      expect(limiter.keys).toEqual([`verify-workspace-domain:${row.id}`])
    })
  })

  describe('domainUsesOf', () => {
    it('names each use the domain has, from the tables that own them', async () => {
      await seedSendingDomain('acme.com', 'pending')
      await testDb
        .insert(ssoVerifiedDomain)
        .values({ name: 'acme.com', verificationToken: `tok${suffix()}` })
      await seedSettings({
        helpCenterConfig: JSON.stringify({ domain: { domain: 'acme.com', verifiedAt: null } }),
      })
      expect(await domainUsesOf('ACME.com')).toEqual(['email', 'customDomain', 'signIn'])
      expect(await domainUsesOf('acme.io')).toEqual([])
    })

    it('counts a Cloud custom domain as a use', async () => {
      const at = '2026-10-01T12:00:00.000Z'
      await seedSettings({
        cloudIdentity: {
          version: 1,
          displayName: 'Acme',
          canonicalOrigin: 'https://acme.example.com',
          platformHostname: 'acme.example.com',
          customDomains: [
            { hostname: 'feedback.acme.com', readiness: 'pending', isPrimary: true, updatedAt: at },
          ],
          updatedAt: at,
        },
      })
      expect(await domainUsesOf('feedback.acme.com')).toEqual(['customDomain'])
    })
  })

  describe('removeDomain', () => {
    it('removes a domain no use holds', async () => {
      await addDomain('acme.com')
      await removeDomain('acme.com')
      expect(await getDomain('acme.com')).toBeNull()
    })

    it('refuses while a use still holds the name, and keeps the row', async () => {
      await addDomain('acme.com')
      await seedSendingDomain('acme.com', 'pending')
      await expect(removeDomain('acme.com')).rejects.toBeInstanceOf(ConflictError)
      expect(await getDomain('acme.com')).not.toBeNull()
    })

    it('refuses a name that has not been added', async () => {
      await expect(removeDomain('acme.com')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses while a verified sign-in domain under it rests on it alone', async () => {
      const row = await addDomain('acme.com')
      await testDb.update(domains).set({ status: 'verified' }).where(eq(domains.id, row.id))
      await testDb
        .insert(ssoVerifiedDomain)
        .values({ name: 'eu.acme.com', verificationToken: 'T1', verifiedAt: new Date() })

      const refused = removeDomain('acme.com')
      await expect(refused).rejects.toBeInstanceOf(ConflictError)
      await expect(removeDomain('acme.com')).rejects.toThrow(/eu\.acme\.com/)
      expect(await getDomain('acme.com')).not.toBeNull()
    })

    it('removes it once that sign-in domain holds its own record', async () => {
      const row = await addDomain('acme.com')
      await testDb.update(domains).set({ status: 'verified' }).where(eq(domains.id, row.id))
      await testDb
        .insert(ssoVerifiedDomain)
        .values({ name: 'eu.acme.com', verificationToken: 'T1', verifiedAt: new Date() })
      zone.published.set('_quackback-verify.eu.acme.com', ['qb-domain-verify=T1'])

      await removeDomain('acme.com')
      expect(await getDomain('acme.com')).toBeNull()
    })
  })
})
