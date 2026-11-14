/**
 * The ownership token a sending row on the provider's own keys is issued, when
 * this workspace also added the domain by name, against a real database rolled
 * back after each test.
 *
 * The provider is a fake that is never verified, and the zone check records
 * the records it was handed, so which token a row is checked for is visible.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamId } from '@quackback/ids'
import type { SesDomainIdentity } from '@quackback/email/ses-identity'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  domains,
  emailSendingDomains,
  teams,
  type EmailSendingDomain,
  type SendingDomainDnsRecord,
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
vi.mock('@quackback/email/ses-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email/ses-identity')>()),
  getSesDomainIdentity: async () => pending,
  putSesMailFromDomain: async () => {},
}))

const checked = vi.hoisted(() => ({ records: [] as SendingDomainDnsRecord[] }))
vi.mock('../domain-verification', () => ({
  checkSendingDomainOwnership: async (_domain: string, expected: SendingDomainDnsRecord[]) => {
    checked.records = expected
    return 'absent'
  },
}))

vi.mock('@/lib/server/dns/resolver', () => {
  const none = async (host: string) => {
    throw Object.assign(new Error(`ENODATA ${host}`), { code: 'ENODATA' })
  }
  const resolver = {
    resolveTxt: none,
    resolveCname: none,
    resolveMx: none,
    resolve4: none,
    resolveNs: none,
  }
  return { systemResolver: resolver, interactiveResolver: resolver }
})

import { OWNERSHIP_VALUE_PREFIX, refreshSendingDomain } from '../sending-identity'

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
    checked.records = []
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
    // And that record is the one the zone is checked for.
    expect(checked.records.map((r) => r.value)).toEqual([tokenOf(row)])
  })

  it('never gives the same token to a second row', async () => {
    await addedDomain('tenant-a.example', TOKEN)
    const a = await newEasyRow('tenant-a.example')
    const b = await newEasyRow('tenant-a.example')

    expect(tokenOf(a)).toBe(`${OWNERSHIP_VALUE_PREFIX}${TOKEN}`)
    expect(tokenOf(b)).toMatch(FRESH)
    expect(tokenOf(b)).not.toBe(tokenOf(a))
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
})
