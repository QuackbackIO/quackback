/**
 * A verified sending domain survives a lookup that went unanswered. When the
 * zone says its ownership record is gone, it is warned once and kept for the
 * grace period, and demoted only if the record is still gone when the period
 * ends.
 *
 * The real ownership checker runs here, over a fake zone that can make any
 * name time out or fail, so the line between "the record is not there" and
 * "the nameserver did not say" is the production one. Every double answers
 * from its arguments: the provider by domain, the zone by the exact name.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type TeamId } from '@quackback/ids'
import type { SesDomainIdentity, SesIdentityCreation } from '@quackback/email/ses-identity'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  teams,
  user,
  principal,
  emailSendingDomains,
  inAppNotifications,
  type EmailSendingDomain,
  type SendingDomainDnsRecord,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const providerState = new Map<string, SesDomainIdentity>()
vi.mock('@quackback/email/ses-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email/ses-identity')>()),
  createSesDomainIdentity: async (domain: string): Promise<SesIdentityCreation> => ({
    identity: providerState.get(domain) ?? pendingIdentity(domain),
    preexisting: providerState.has(domain),
  }),
  getSesDomainIdentity: async (domain: string) => providerState.get(domain) ?? null,
  putSesMailFromDomain: async (domain: string, mailFrom: string) => putMailFrom(domain, mailFrom),
}))
const putMailFrom = vi.fn<(domain: string, mailFrom: string) => Promise<void>>()

type ZoneEntry = {
  TXT?: string[][]
  CNAME?: string[]
  MX?: { exchange: string; priority: number }[]
  A?: string[]
  NS?: string[]
}
const zone = new Map<string, ZoneEntry>()
/** Names whose nameserver fails with this code, whatever is published there. */
const unanswered = new Map<string, string>()
/** Every TXT lookup, by which resolver made it. */
const txtLookups: string[] = []
vi.mock('@/lib/server/dns/resolver', () => {
  const read = async <K extends keyof ZoneEntry>(host: string, kind: K) => {
    const code = unanswered.get(host)
    if (code) throw Object.assign(new Error(`${code} ${host}`), { code })
    const value = zone.get(host)?.[kind]
    if (!value || value.length === 0) {
      throw Object.assign(new Error(`ENODATA ${host}`), { code: 'ENODATA' })
    }
    return value as NonNullable<ZoneEntry[K]>
  }
  const resolver = (name: string) => ({
    resolveTxt: (host: string) => (txtLookups.push(`${name} ${host}`), read(host, 'TXT')),
    resolveCname: (host: string) => read(host, 'CNAME'),
    resolveMx: (host: string) => read(host, 'MX'),
    resolve4: (host: string) => read(host, 'A'),
    resolveNs: (host: string) => read(host, 'NS'),
  })
  return { systemResolver: resolver('system'), interactiveResolver: resolver('interactive') }
})

const sentAttention = vi.fn()
vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  isEmailConfigured: () => true,
  sendSendingDomainAttentionEmail: async (params: unknown) => {
    sentAttention(params)
    return { sent: true }
  },
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/settings/tier-limits.service')>()
  const { OSS_TIER_LIMITS } = await import('@/lib/server/domains/settings/tier-limits.types')
  return { ...actual, getTierLimits: async () => ({ ...OSS_TIER_LIMITS, maxSendingDomains: null }) }
})

import { getSendingDomain } from '../channel-account.service'
import {
  provisionSendingDomain,
  refreshSendingDomain,
  sweepSendingDomains,
} from '../sending-identity'

function pendingIdentity(domain: string): SesDomainIdentity {
  return {
    domain,
    dkimTokens: ['aaa', 'bbb', 'ccc'],
    signingHostedZone: null,
    dkimStatus: 'PENDING',
    verifiedForSending: false,
    mailFrom: { domain: `qb-bounce.${domain}`, status: 'PENDING' },
  }
}

function verifiedIdentity(domain: string): SesDomainIdentity {
  return {
    ...pendingIdentity(domain),
    dkimStatus: 'SUCCESS',
    verifiedForSending: true,
    mailFrom: { domain: `qb-bounce.${domain}`, status: 'SUCCESS' },
  }
}

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

const DAY = 24 * 60 * 60 * 1000

/** The full name of a provider-keyed row's ownership TXT. */
function ownershipName(row: EmailSendingDomain): string {
  const record = row.dnsRecords.find((r) => r.purpose === 'ownership')
  if (!record) throw new Error('row has no ownership record')
  return `${record.host}.${row.domain}`
}

/** The full name of the row's ownership proof: its own signing key. */
function proofName(row: EmailSendingDomain): string {
  const key = row.dnsRecords.find((r) => r.type === 'TXT' && r.purpose === 'dkim')
  if (!key) throw new Error('row has no signing key record')
  return `${key.host}.${row.domain}`
}

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailSendingDomains.mailFromLabel }).from(emailSendingDomains).limit(0)
  },
})

async function seedAdmin(): Promise<PrincipalId> {
  const userId = createId('user')
  const principalId = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Admin', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return principalId
}

/** Start a row's grace period at a given moment, as an earlier check would have. */
async function setMissingSince(row: EmailSendingDomain, since: Date) {
  await testDb
    .update(emailSendingDomains)
    .set({ ownershipMissingSince: since })
    .where(eq(emailSendingDomains.id, row.id))
}

async function attentionBells(person: PrincipalId) {
  return testDb
    .select()
    .from(inAppNotifications)
    .where(
      and(
        eq(inAppNotifications.principalId, person),
        eq(inAppNotifications.type, 'sending_domain_needs_attention')
      )
    )
}

describe.skipIf(!fixture.available)('sending domain checks on unanswered DNS', () => {
  let teamId: TeamId
  let admin: PrincipalId

  beforeEach(async () => {
    await fixture.begin()
    vi.stubEnv('EMAIL_SES_ACCESS_KEY_ID', 'AKIASEND')
    vi.stubEnv('EMAIL_SES_SECRET_ACCESS_KEY', 'send-secret')
    vi.stubEnv('EMAIL_SMTP_HOST', '')
    vi.stubEnv('EMAIL_RESEND_API_KEY', '')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_SES_REGION', 'eu-west-2')
    vi.stubEnv('EMAIL_SES_IDENTITY_ACCESS_KEY_ID', 'AKIAIDENT')
    vi.stubEnv('EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY', 'ident-secret')
    vi.stubEnv('EMAIL_FROM', 'Quackback <notifications@mail.platform.test>')
    vi.stubEnv('EMAIL_INBOUND_DOMAIN', 'mail.platform.test')
    providerState.clear()
    zone.clear()
    unanswered.clear()
    txtLookups.length = 0
    sentAttention.mockReset()
    putMailFrom.mockReset().mockResolvedValue()
    const [team] = await testDb.insert(teams).values({ name: 'Support' }).returning()
    teamId = team.id
    admin = await seedAdmin()
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  /** A domain whose owner published everything and the provider signs for. */
  async function verifiedDomain(): Promise<EmailSendingDomain> {
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
    publish('a.example', row.dnsRecords)
    providerState.set('a.example', verifiedIdentity('a.example'))
    const checked = await refreshSendingDomain(row.id)
    expect(checked?.status).toBe('verified')
    return checked as EmailSendingDomain
  }

  it('keeps a verified domain verified, silently, when its proof lookup times out', async () => {
    const row = await verifiedDomain()
    unanswered.set(proofName(row), 'ETIMEOUT')

    expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 0 })
    const after = await getSendingDomain(row.id)
    expect(after?.status).toBe('verified')
    expect(after?.verifiedAt).toEqual(row.verifiedAt)
    // An unanswered lookup is not a miss: no grace period starts.
    expect(after?.ownershipMissingSince).toBeNull()
    expect(await attentionBells(admin)).toHaveLength(0)
    expect(sentAttention).not.toHaveBeenCalled()
  })

  it('leaves a running grace period as it is when the lookup goes unanswered', async () => {
    const row = await verifiedDomain()
    const since = new Date(Date.now() - 2 * DAY)
    await setMissingSince(row, since)
    unanswered.set(proofName(row), 'ETIMEOUT')

    expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 0 })
    const after = await getSendingDomain(row.id)
    expect(after?.status).toBe('verified')
    expect(after?.ownershipMissingSince).toEqual(since)
    expect(sentAttention).not.toHaveBeenCalled()
  })

  it('keeps it through a nameserver failure too', async () => {
    const row = await verifiedDomain()
    unanswered.set(proofName(row), 'ESERVFAIL')

    expect((await refreshSendingDomain(row.id))?.status).toBe('verified')
  })

  it('reads a verified domain’s proof with the resolver that tries twice', async () => {
    const row = await verifiedDomain()
    txtLookups.length = 0

    await sweepSendingDomains()
    expect(txtLookups).toContain(`interactive ${proofName(row)}`)
    expect(txtLookups).not.toContain(`system ${proofName(row)}`)
  })

  it('warns once and keeps a verified domain verified when its proof record first goes missing', async () => {
    const row = await verifiedDomain()
    zone.delete(proofName(row))

    expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 0 })
    const after = await getSendingDomain(row.id)
    expect(after?.status).toBe('verified')
    expect(after?.ownershipMissingSince).not.toBeNull()
    expect(await attentionBells(admin)).toHaveLength(1)
    expect(sentAttention).toHaveBeenCalledTimes(1)
    expect(sentAttention.mock.calls[0][0]).toMatchObject({
      record: { purpose: 'ownership', name: proofName(row), state: 'missing' },
      deadline: expect.any(String),
    })

    // Still missing inside the grace period: still verified, and no second warning.
    expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 0 })
    expect(await refreshSendingDomain(row.id)).toMatchObject({ status: 'verified' })
    const later = await getSendingDomain(row.id)
    expect(later?.ownershipMissingSince).toEqual(after?.ownershipMissingSince)
    expect(await attentionBells(admin)).toHaveLength(1)
    expect(sentAttention).toHaveBeenCalledTimes(1)
  })

  it('demotes and tells the managers when the grace period ends with the record still missing', async () => {
    const row = await verifiedDomain()
    zone.delete(proofName(row))
    await setMissingSince(row, new Date(Date.now() - 8 * DAY))

    expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 1 })
    expect((await getSendingDomain(row.id))?.status).toBe('pending')
    expect(await attentionBells(admin)).toHaveLength(1)
    expect(sentAttention).toHaveBeenCalledTimes(1)
    // The demotion notice, not the warning.
    expect(sentAttention.mock.calls[0][0]).not.toHaveProperty('deadline', expect.any(String))
  })

  it('ends the grace period when the record is back', async () => {
    const row = await verifiedDomain()
    zone.delete(proofName(row))
    await sweepSendingDomains()
    expect((await getSendingDomain(row.id))?.ownershipMissingSince).not.toBeNull()

    publish('a.example', row.dnsRecords)
    expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 0 })
    const after = await getSendingDomain(row.id)
    expect(after?.status).toBe('verified')
    expect(after?.ownershipMissingSince).toBeNull()
  })

  it('demotes on the provider’s word even while the proof lookup times out', async () => {
    const row = await verifiedDomain()
    unanswered.set(proofName(row), 'ETIMEOUT')
    providerState.set('a.example', { ...verifiedIdentity('a.example'), verifiedForSending: false })

    expect((await sweepSendingDomains()).demoted).toBe(1)
    expect((await getSendingDomain(row.id))?.status).toBe('pending')
  })

  it('leaves a pending domain pending when its proof lookup times out', async () => {
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
    publish('a.example', row.dnsRecords)
    providerState.set('a.example', verifiedIdentity('a.example'))
    unanswered.set(proofName(row), 'ETIMEOUT')

    const after = await refreshSendingDomain(row.id)
    expect(after?.status).toBe('pending')
    expect(after?.verifiedAt).toBeNull()
    // Read with the single try a background check of a pending row uses.
    expect(txtLookups).toContain(`system ${proofName(row)}`)
  })
  /**
   * A row on the provider's own keys, proven with its `_quackback` token,
   * which the provider signs for and whose records are all published.
   */
  async function verifiedEasyDomain(domain = 'b.example'): Promise<EmailSendingDomain> {
    const [row] = await testDb
      .insert(emailSendingDomains)
      .values({
        owningTeamId: teamId,
        domain,
        mailFromLabel: 'qb-bounce',
        autoCheckUntil: new Date(Date.now() + 3600_000),
      })
      .returning()
    providerState.set(domain, verifiedIdentity(domain))
    // The first check mints the token; nothing is published yet.
    const first = await refreshSendingDomain(row.id)
    expect(first?.status).toBe('pending')
    publish(domain, first?.dnsRecords ?? [])
    const checked = await refreshSendingDomain(row.id)
    expect(checked?.status).toBe('verified')
    expect(checked?.verifiedAt).not.toBeNull()
    return checked as EmailSendingDomain
  }

  it('names the ownership TXT, its value and the date in the warning', async () => {
    const row = await verifiedEasyDomain()
    const txt = row.dnsRecords.find((r) => r.purpose === 'ownership')
    zone.delete(ownershipName(row))

    expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 0 })
    const after = await getSendingDomain(row.id)
    expect(after?.status).toBe('verified')
    const since = after?.ownershipMissingSince as Date
    const deadline = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(since.getTime() + 7 * DAY)
    )
    expect(sentAttention.mock.calls[0][0]).toMatchObject({
      domain: 'b.example',
      record: {
        purpose: 'ownership',
        type: 'TXT',
        name: ownershipName(row),
        state: 'missing',
        value: txt?.value,
      },
      deadline,
    })
    const [bell] = await attentionBells(admin)
    expect(bell.body).toContain(`Add it back by ${deadline} to keep sending from b.example.`)
  })

  it('demotes on a DKIM failure without waiting out the grace period', async () => {
    const row = await verifiedEasyDomain()
    zone.delete(ownershipName(row))
    providerState.set('b.example', {
      ...verifiedIdentity('b.example'),
      dkimStatus: 'FAILED',
      verifiedForSending: false,
    })

    expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 1 })
    expect((await getSendingDomain(row.id))?.status).toBe('failed')
    expect(await attentionBells(admin)).toHaveLength(1)
    expect(sentAttention).toHaveBeenCalledTimes(1)
  })

  it('does not put back a demoted domain while its ownership TXT is still missing', async () => {
    const row = await verifiedEasyDomain()
    zone.delete(ownershipName(row))
    // As the end of a grace period left it.
    await testDb
      .update(emailSendingDomains)
      .set({ status: 'pending', ownershipMissingSince: new Date(Date.now() - 8 * DAY) })
      .where(eq(emailSendingDomains.id, row.id))

    expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 0 })
    expect((await getSendingDomain(row.id))?.status).toBe('pending')
    expect(sentAttention).not.toHaveBeenCalled()
  })

  it('leaves a never-verified domain pending while its ownership TXT is absent', async () => {
    const [row] = await testDb
      .insert(emailSendingDomains)
      .values({
        owningTeamId: teamId,
        domain: 'c.example',
        mailFromLabel: 'qb-bounce',
        autoCheckUntil: new Date(Date.now() + 3600_000),
      })
      .returning()
    providerState.set('c.example', verifiedIdentity('c.example'))
    const first = await refreshSendingDomain(row.id)
    // Everything but the ownership TXT is published.
    publish(
      'c.example',
      (first?.dnsRecords ?? []).filter((r) => r.purpose !== 'ownership')
    )

    const after = await refreshSendingDomain(row.id)
    expect(after?.status).toBe('pending')
    expect(after?.verifiedAt).toBeNull()
    // Waiting for its proof, not warned about losing it.
    expect(after?.ownershipMissingSince).toBeNull()
    expect(await attentionBells(admin)).toHaveLength(0)
    expect(sentAttention).not.toHaveBeenCalled()
  })

  it('attaches a missing MAIL FROM only on a check that finds the ownership TXT', async () => {
    const row = await verifiedEasyDomain()
    zone.delete(ownershipName(row))
    providerState.set('b.example', { ...verifiedIdentity('b.example'), mailFrom: null })

    expect((await refreshSendingDomain(row.id))?.status).toBe('pending')
    expect(putMailFrom).not.toHaveBeenCalled()

    publish(
      'b.example',
      row.dnsRecords.filter((r) => r.purpose === 'ownership')
    )
    await refreshSendingDomain(row.id)
    expect(putMailFrom).toHaveBeenCalledWith('b.example', 'qb-bounce.b.example')
  })
})
