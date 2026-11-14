/**
 * The ownership token a sending row on the provider's own keys is issued, when
 * this workspace also added the domain by name, against a real database rolled
 * back after each test.
 *
 * The provider is a fake, and the zone is a fake resolver behind the real
 * ownership checks, so what a published record does and does not prove is
 * observable end to end.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamId } from '@quackback/ids'
import type { SesDomainIdentity } from '@quackback/email/ses-identity'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  domains,
  emailSendingDomains,
  ssoVerifiedDomain,
  teams,
  type EmailSendingDomain,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const pending: SesDomainIdentity = {
  domain: 'tenant-a.example',
  dkimTokens: [],
  signingHostedZone: null,
  dkimStatus: 'PENDING',
  verifiedForSending: false,
  mailFrom: null,
}
/** The provider's answer, which by itself proves nothing about ownership. */
const provider = vi.hoisted(() => ({ identity: null as SesDomainIdentity | null }))
vi.mock('@quackback/email/ses-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email/ses-identity')>()),
  getSesDomainIdentity: async () => provider.identity,
  putSesMailFromDomain: async () => {},
}))

/** The zone: TXT values by full name, and every TXT name asked about. */
const zone = vi.hoisted(() => ({ txt: new Map<string, string[]>(), asked: [] as string[] }))
vi.mock('@/lib/server/dns/resolver', () => {
  const none = async (host: string) => {
    throw Object.assign(new Error(`ENODATA ${host}`), { code: 'ENODATA' })
  }
  const resolver = {
    resolveTxt: async (host: string) => {
      zone.asked.push(host)
      const values = zone.txt.get(host)
      return values ? values.map((v) => [v]) : none(host)
    },
    resolveCname: none,
    resolveMx: none,
    resolve4: none,
    resolveNs: none,
  }
  return { systemResolver: resolver, interactiveResolver: resolver }
})
vi.mock('@/lib/server/kv/pg-kv', () => ({ kvSetNx: async () => true }))

import { OWNERSHIP_VALUE_PREFIX, refreshSendingDomain } from '../sending-identity'
import { issueOwnershipToken } from '../sending-domain-token'
import { checkDomainOwnership } from '@/lib/server/domains/domain-proof/domains.service'
import { checkSsoDomainOwnership } from '@/lib/server/domains/domain-proof/sso-domain-check'
import { getProvenZones, provenZoneCovering } from '@/lib/server/domains/domain-proof/proven-zones'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailSendingDomains.dkimMode }).from(emailSendingDomains).limit(0)
    await db.select({ t: domains.ownershipToken }).from(domains).limit(0)
  },
})

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const FRESH = new RegExp(`^${OWNERSHIP_VALUE_PREFIX}[0-9a-f]{32}$`)

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${suffix()}` })
    .returning()
  return team.id
}

/** A new row on the provider's own keys, with nothing issued yet. */
async function newEasyRow(domain: string): Promise<EmailSendingDomain | null> {
  const [row] = await testDb
    .insert(emailSendingDomains)
    .values({ owningTeamId: await seedTeam(), domain, mailFromLabel: 'qb-bounce' })
    .returning()
  return refreshSendingDomain(row.id)
}

async function addedDomain(name: string, token: string) {
  await testDb.insert(domains).values({ name, ownershipToken: token })
}

const tokenOf = (row: EmailSendingDomain | null) =>
  row?.dnsRecords.find((r) => r.purpose === 'ownership')?.value

describe.skipIf(!fixture.available)('sending row token on a domain added by name', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.stubEnv('EMAIL_SES_REGION', 'eu-west-2')
    vi.stubEnv('EMAIL_FROM', 'Quackback <notifications@mail.platform.test>')
    provider.identity = pending
    zone.txt.clear()
    zone.asked.length = 0
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('issues a new row the domain’s own token, so one record proves both', async () => {
    await addedDomain('tenant-a.example', TOKEN)
    const row = await newEasyRow('Tenant-A.example')

    expect(tokenOf(row)).toBe(`${OWNERSHIP_VALUE_PREFIX}${TOKEN}`)
  })

  it('never gives the same token to a second row', async () => {
    await addedDomain('tenant-a.example', TOKEN)
    const a = await newEasyRow('tenant-a.example')
    const b = await newEasyRow('tenant-a.example')

    expect(tokenOf(a)).toBe(`${OWNERSHIP_VALUE_PREFIX}${TOKEN}`)
    expect(tokenOf(b)).toMatch(FRESH)
    expect(tokenOf(b)).not.toBe(tokenOf(a))
  })

  it('claims the token when it is issued, so a second row issued before the first is saved gets a fresh one', async () => {
    await addedDomain('tenant-a.example', TOKEN)
    const rows = await testDb
      .insert(emailSendingDomains)
      .values([
        { owningTeamId: await seedTeam(), domain: 'tenant-a.example' },
        { owningTeamId: await seedTeam(), domain: 'tenant-a.example' },
      ])
      .returning()

    // Neither row has been checked or saved yet: the claim alone decides.
    // (The fixture runs on one connection, where an advisory lock is
    // re-entrant, so the lock itself cannot be raced here; the claim written
    // before it is released is what a second issue sees.)
    const a = await issueOwnershipToken(rows[0])
    const b = await issueOwnershipToken(rows[1])
    expect(a).toBe(TOKEN)
    expect(b).toMatch(/^[0-9a-f]{32}$/)
    expect(b).not.toBe(TOKEN)
    // Issuing again for the row that holds it keeps it.
    expect(await issueOwnershipToken(rows[0])).toBe(TOKEN)
  })

  it('mints a fresh token when the domain added is another name, even one above it', async () => {
    await addedDomain('example', TOKEN)
    await addedDomain('tenant-b.example', 'b1b2c3d4e5f60718293a4b5c6d7e8f90')
    const row = await newEasyRow('tenant-a.example')

    expect(tokenOf(row)).toMatch(FRESH)
    expect(tokenOf(row)).not.toContain(TOKEN)
    expect(tokenOf(row)).not.toContain('b1b2c3d4')
  })

  it('keeps the token a row already carries when a domain is added later', async () => {
    const row = await newEasyRow('tenant-a.example')
    await addedDomain('tenant-a.example', TOKEN)

    expect(tokenOf(await refreshSendingDomain(row!.id))).toBe(tokenOf(row))
  })

  it("never uses another workspace's domain", async () => {
    await addedDomain('tenant-a.example', TOKEN)
    await fixture.rollback()
    await fixture.begin()

    expect(tokenOf(await newEasyRow('tenant-a.example'))).toMatch(FRESH)
    expect(tokenOf(await newEasyRow('tenant-a.example'))).not.toContain(TOKEN)
  })

  describe('one published record', () => {
    const verifiedIdentity: SesDomainIdentity = {
      ...pending,
      dkimTokens: ['aaa'],
      dkimStatus: 'SUCCESS',
      verifiedForSending: true,
      mailFrom: { domain: 'qb-bounce.tenant-a.example', status: 'SUCCESS' },
    }

    it('verifies neither the sending row nor sign-in while the domain is pending and unpublished', async () => {
      await addedDomain('tenant-a.example', TOKEN)
      const row = await newEasyRow('tenant-a.example')
      // The provider says verified, as it would to every workspace on the account.
      provider.identity = verifiedIdentity

      expect((await refreshSendingDomain(row!.id))?.status).toBe('pending')
      expect(await checkDomainOwnership('tenant-a.example')).toEqual({
        ok: false,
        reason: 'no-record',
      })
      const [sso] = await testDb
        .insert(ssoVerifiedDomain)
        .values({ name: 'tenant-a.example', verificationToken: 'SSO1' })
        .returning()
      expect(await checkSsoDomainOwnership(sso)).toEqual({ ok: false, reason: 'no-record' })
    })

    it('verifies the domain, its sending row and sign-in under it', async () => {
      await addedDomain('tenant-a.example', TOKEN)
      const row = await newEasyRow('tenant-a.example')
      zone.txt.set('_quackback.tenant-a.example', [`${OWNERSHIP_VALUE_PREFIX}${TOKEN}`])
      provider.identity = verifiedIdentity

      expect(await checkDomainOwnership('tenant-a.example')).toEqual({ ok: true, via: 'dns' })
      const [sso] = await testDb
        .insert(ssoVerifiedDomain)
        .values({ name: 'eu.tenant-a.example', verificationToken: 'SSO2' })
        .returning()
      zone.asked.length = 0
      expect(await checkSsoDomainOwnership(sso)).toEqual({ ok: true, via: 'domain' })
      expect(zone.asked).toEqual([])
      expect((await refreshSendingDomain(row!.id))?.status).toBe('verified')
    })

    it('verifies the pending domain when the sending check finds the token they share', async () => {
      await addedDomain('tenant-a.example', TOKEN)
      const row = await newEasyRow('tenant-a.example')
      zone.txt.set('_quackback.tenant-a.example', [`${OWNERSHIP_VALUE_PREFIX}${TOKEN}`])
      provider.identity = verifiedIdentity

      // Nobody presses Check on the domain: the sending check alone finds the record.
      expect((await refreshSendingDomain(row!.id))?.status).toBe('verified')
      const [added] = await testDb.select().from(domains)
      expect(added.status).toBe('verified')
      expect(added.verifiedAt).not.toBeNull()
      expect(provenZoneCovering('eu.tenant-a.example', await getProvenZones())?.zone).toBe(
        'tenant-a.example'
      )
    })

    it('leaves the domain pending when the sending row verified on a token of its own', async () => {
      const row = await newEasyRow('tenant-a.example')
      await addedDomain('tenant-a.example', TOKEN)
      zone.txt.set('_quackback.tenant-a.example', [`${tokenOf(row)}`])
      provider.identity = verifiedIdentity

      expect((await refreshSendingDomain(row!.id))?.status).toBe('verified')
      const [added] = await testDb.select().from(domains)
      expect(added.status).toBe('pending')
    })

    it("never verifies on another row's token", async () => {
      await addedDomain('tenant-a.example', TOKEN)
      const row = await newEasyRow('tenant-a.example')
      zone.txt.set('_quackback.tenant-a.example', [`${OWNERSHIP_VALUE_PREFIX}${'f'.repeat(32)}`])
      provider.identity = verifiedIdentity

      expect(await checkDomainOwnership('tenant-a.example')).toEqual({
        ok: false,
        reason: 'mismatch',
      })
      expect((await refreshSendingDomain(row!.id))?.status).toBe('pending')
    })
  })
})
