/**
 * A sending domain set up while the operator serves bounce records under a
 * domain of its own: the return path is one CNAME, and a row keeps the records
 * it was set up with. Against a real database, a fake provider and a fake zone.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { TeamId } from '@quackback/ids'
import type { SesDomainIdentity, SesIdentityCreation } from '@quackback/email/ses-identity'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { teams, emailSendingDomains, type SendingDomainDnsRecord } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const createIdentity =
  vi.fn<
    (
      domain: string,
      signing?: { selector: string; privateKey: string }
    ) => Promise<SesIdentityCreation>
  >()
const getIdentity = vi.fn<(domain: string) => Promise<SesDomainIdentity | null>>()
const putMailFrom = vi.fn<(domain: string, mailFrom: string) => Promise<void>>()

vi.mock('@quackback/email/ses-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email/ses-identity')>()),
  createSesDomainIdentity: (
    domain: string,
    _deps?: unknown,
    signing?: { selector: string; privateKey: string }
  ) => createIdentity(domain, signing),
  getSesDomainIdentity: (domain: string) => getIdentity(domain),
  putSesMailFromDomain: (domain: string, mailFrom: string) => putMailFrom(domain, mailFrom),
}))

/** Ownership, decided here; the records it is asked about must be proof records. */
const ownershipResolves = vi.fn<() => Promise<boolean>>()
vi.mock('../domain-verification', () => ({
  checkSendingDomainOwnership: async (_domain: string, expected: SendingDomainDnsRecord[]) => {
    const isProof = (r: SendingDomainDnsRecord) =>
      r.type === 'TXT' && r.purpose === 'dkim' && r.value.includes('p=')
    if (expected.length === 0 || !expected.every(isProof)) return 'absent'
    return (await ownershipResolves()) ? 'proven' : 'absent'
  },
  ownershipRecordSatisfied: () => false,
}))

/** The zone, by full name and type; ENODATA for anything not published there. */
type ZoneEntry = {
  TXT?: string[][]
  CNAME?: string[]
  MX?: { exchange: string; priority: number }[]
  A?: string[]
  AAAA?: string[]
  NS?: string[]
}
const zone = new Map<string, ZoneEntry>()
vi.mock('@/lib/server/dns/resolver', () => {
  const read = async <K extends keyof ZoneEntry>(host: string, kind: K) => {
    const value = zone.get(host)?.[kind]
    if (!value || value.length === 0) {
      throw Object.assign(new Error(`ENODATA ${host}`), { code: 'ENODATA' })
    }
    return value as NonNullable<ZoneEntry[K]>
  }
  const resolver = {
    resolveTxt: (host: string) => read(host, 'TXT'),
    resolveCname: (host: string) => read(host, 'CNAME'),
    resolveMx: (host: string) => read(host, 'MX'),
    resolve4: (host: string) => read(host, 'A'),
    resolve6: (host: string) => read(host, 'AAAA'),
    resolveNs: (host: string) => read(host, 'NS'),
  }
  return { systemResolver: resolver, interactiveResolver: resolver }
})

/** Publish records into the zone exactly as a domain owner following them would. */
function publish(domain: string, records: SendingDomainDnsRecord[]) {
  for (const r of records) {
    const name = r.host === '@' ? domain : `${r.host}.${domain}`
    const entry = zone.get(name) ?? {}
    if (r.type === 'TXT') entry.TXT = [...(entry.TXT ?? []), [r.value]]
    if (r.type === 'CNAME') entry.CNAME = [r.value]
    if (r.type === 'MX') entry.MX = [{ exchange: r.value, priority: r.priority }]
    zone.set(name, entry)
  }
}

import { provisionSendingDomain, refreshSendingDomain } from '../sending-identity'

const REGION = 'eu-west-2'

const identity = (over: Partial<SesDomainIdentity> = {}): SesDomainIdentity => ({
  domain: 'tenant-a.example',
  dkimTokens: [],
  signingHostedZone: null,
  dkimStatus: 'SUCCESS',
  verifiedForSending: true,
  mailFrom: { domain: 'qb-bounce.tenant-a.example', status: 'SUCCESS' },
  ...over,
})
const madeIt = (over: Partial<SesDomainIdentity> = {}): SesIdentityCreation => ({
  identity: identity(over),
  preexisting: false,
})
const foundIt = (over: Partial<SesDomainIdentity> = {}): SesIdentityCreation => ({
  identity: identity(over),
  preexisting: true,
})

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailSendingDomains.id }).from(emailSendingDomains).limit(0)
  },
})

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` })
    .returning()
  return team.id
}

describe.skipIf(!fixture.available)('an operator return path domain (real DB, rolled back)', () => {
  const TARGET = 'ws-8fc0ff855f96e8aa09b38e87.bounces.example.net'
  beforeEach(async () => {
    await fixture.begin()
    vi.stubEnv('EMAIL_SES_REGION', REGION)
    vi.stubEnv('EMAIL_FROM', 'Quackback <notifications@mail.platform.test>')
    vi.stubEnv('EMAIL_INBOUND_DOMAIN', 'mail.platform.test')
    createIdentity.mockReset().mockResolvedValue(madeIt({ dkimStatus: 'PENDING' }))
    putMailFrom.mockReset().mockResolvedValue()
    ownershipResolves.mockReset().mockResolvedValue(false)
    zone.clear()
    vi.stubEnv('EMAIL_RETURN_PATH_DOMAIN', 'bounces.example.net')
    vi.stubEnv('QUACKBACK_INSTANCE_ID', 'inst_example1')
    // A new domain: the provider has no identity for it until the create.
    getIdentity.mockResolvedValue(null)
    // The operator's wildcard, as the target answers it.
    zone.set(TARGET, {
      MX: [{ exchange: `feedback-smtp.${REGION}.amazonses.com`, priority: 10 }],
      TXT: [['v=spf1 include:amazonses.com ~all']],
    })
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('sets a new domain up with two records and no provider values in its DNS', async () => {
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })

    const selector = createIdentity.mock.calls[0][1]?.selector
    expect(row.dnsRecords.map((r) => `${r.type} ${r.host} ${r.purpose}`)).toEqual([
      `TXT ${selector}._domainkey dkim`,
      'CNAME qb-bounce mail-from',
    ])
    expect(row.dnsRecords[1].value).toBe(TARGET)
    expect(JSON.stringify(row.dnsRecords)).not.toContain('amazonses')
    // The provider's MAIL FROM is the customer's own name, as without it.
    expect(putMailFrom).toHaveBeenCalledWith('tenant-a.example', 'qb-bounce.tenant-a.example')
  })

  it('finds both records once published and keeps the CNAME across checks', async () => {
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    publish('tenant-a.example', row.dnsRecords)
    ownershipResolves.mockResolvedValue(true)
    getIdentity.mockResolvedValue(identity())

    // Unset afterwards: the row keeps the records it was set up with.
    vi.stubEnv('EMAIL_RETURN_PATH_DOMAIN', '')
    const refreshed = await refreshSendingDomain(row.id)
    expect(refreshed?.status).toBe('verified')
    expect(refreshed?.dnsRecords.map((r) => `${r.type} ${r.value} ${r.check?.state}`)).toEqual([
      `TXT ${row.dnsRecords[0].value} found`,
      `CNAME ${TARGET} found`,
    ])
  })

  it('names a CNAME pointing elsewhere', async () => {
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    zone.set('qb-bounce.tenant-a.example', { CNAME: ['ws-other.bounces.example.net'] })
    const refreshed = await refreshSendingDomain(row.id)
    expect(refreshed?.dnsRecords[1].check).toMatchObject({
      state: 'mismatch',
      seen: 'ws-other.bounces.example.net',
    })
  })

  it('keeps a row set up with an MX and TXT on those records', async () => {
    vi.stubEnv('EMAIL_RETURN_PATH_DOMAIN', '')
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    vi.stubEnv('EMAIL_RETURN_PATH_DOMAIN', 'bounces.example.net')
    const refreshed = await refreshSendingDomain(row.id)
    expect(refreshed?.dnsRecords.map((r) => r.type)).toEqual(['TXT', 'MX', 'TXT'])
  })

  it('refuses a name holding any record, since nothing may sit beside a CNAME', async () => {
    zone.set('qb-bounce.tenant-a.example', { TXT: [['site-verification=abc']] })
    const teamId = await seedTeam()
    await expect(
      provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    ).rejects.toThrow('qb-bounce.tenant-a.example already has records that would conflict')
    expect(createIdentity).not.toHaveBeenCalled()
  })

  it('gives an adopted MAIL FROM label the CNAME when its name is empty', async () => {
    const teamId = await seedTeam()
    const attached = {
      mailFrom: { domain: 'bounce.tenant-a.example', status: 'SUCCESS' as const },
    }
    createIdentity.mockResolvedValue(foundIt(attached))
    getIdentity.mockResolvedValue(identity(attached))
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    expect(row.dnsRecords.filter((r) => r.purpose === 'mail-from')).toEqual([
      { type: 'CNAME', host: 'bounce', value: TARGET, purpose: 'mail-from' },
    ])
  })

  it('keeps an adopted MAIL FROM on the MX and TXT it already uses', async () => {
    const teamId = await seedTeam()
    const attached = {
      mailFrom: { domain: 'bounce.tenant-a.example', status: 'SUCCESS' as const },
    }
    createIdentity.mockResolvedValue(foundIt(attached))
    getIdentity.mockResolvedValue(identity(attached))
    zone.set('bounce.tenant-a.example', {
      MX: [{ exchange: `feedback-smtp.${REGION}.amazonses.com`, priority: 10 }],
      TXT: [['v=spf1 include:amazonses.com ~all']],
    })
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    expect(row.preflight.mailFromFree).toBe(true)
    expect(
      row.dnsRecords.filter((r) => r.purpose === 'mail-from').map((r) => `${r.type} ${r.host}`)
    ).toEqual(['MX bounce', 'TXT bounce'])
  })
})
