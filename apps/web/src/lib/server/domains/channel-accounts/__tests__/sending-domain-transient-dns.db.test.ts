/**
 * A verified sending domain survives a lookup that went unanswered, and loses
 * its status only when the zone says its proof is gone.
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
  putSesMailFromDomain: async () => undefined,
}))

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
    expect(await attentionBells(admin)).toHaveLength(0)
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

  it('demotes and tells the managers when the proof record is really gone', async () => {
    const row = await verifiedDomain()
    zone.delete(proofName(row))

    expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 1 })
    expect((await getSendingDomain(row.id))?.status).toBe('pending')
    expect(await attentionBells(admin)).toHaveLength(1)
    expect(sentAttention).toHaveBeenCalledTimes(1)
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
})
