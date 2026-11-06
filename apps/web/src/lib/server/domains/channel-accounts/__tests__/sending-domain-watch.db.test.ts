/**
 * The automatic check on domains being set up, the "Verify" restart, and
 * the notifications a status change sends, against a real database, a fake
 * provider and a fake zone.
 *
 * Every double answers from its arguments: the provider by domain, the zone by
 * the exact name asked, so a check made against the wrong domain or name finds
 * nothing and a provider call for the wrong row is visible in its calls.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type TeamId } from '@quackback/ids'
import type { SesDomainIdentity, SesIdentityCreation } from '@quackback/email/ses-identity'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  inArray,
  teams,
  user,
  principal,
  channelAccounts,
  emailSendingDomains,
  inAppNotifications,
  type SendingDomainDnsRecord,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

/** The provider's view, per domain. A domain it was never told about is unknown. */
const providerState = new Map<string, SesDomainIdentity>()
const getIdentity = vi.fn(async (domain: string) => providerState.get(domain) ?? null)
vi.mock('@quackback/email/ses-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email/ses-identity')>()),
  // An identity the provider already holds is reported as pre-existing, as SES does.
  createSesDomainIdentity: async (domain: string): Promise<SesIdentityCreation> => ({
    identity: providerState.get(domain) ?? pendingIdentity(domain),
    preexisting: providerState.has(domain),
  }),
  getSesDomainIdentity: (domain: string) => getIdentity(domain),
  putSesMailFromDomain: async () => undefined,
}))

/** Ownership answers from the zone too: the token has to be published at `_quackback`. */
vi.mock('../domain-verification', () => ({
  checkSendingDomainOwnership: async (
    domain: string,
    expected: { host: string; value: string; type: string; purpose: string }[]
  ) => {
    if (expected.length === 0) return 'absent'
    // The real checker's rule: only a row's own proof record counts (its
    // token, or its signing key), matched against what the zone publishes.
    const proven = expected.every(
      (r) =>
        r.type === 'TXT' &&
        (r.purpose === 'ownership' || (r.purpose === 'dkim' && r.value.includes('p='))) &&
        (zone.get(`${r.host}.${domain}`)?.TXT ?? []).some((v) => v.join('') === r.value)
    )
    return proven ? 'proven' : 'absent'
  },
}))

type ZoneEntry = {
  TXT?: string[][]
  CNAME?: string[]
  MX?: { exchange: string; priority: number }[]
  A?: string[]
  NS?: string[]
}
const zone = new Map<string, ZoneEntry>()
const zoneLookups: string[] = []
vi.mock('@/lib/server/dns/resolver', () => {
  const read = async <K extends keyof ZoneEntry>(host: string, kind: K) => {
    zoneLookups.push(`${kind} ${host}`)
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
    resolveNs: (host: string) => read(host, 'NS'),
  }
  return { systemResolver: resolver, interactiveResolver: resolver }
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

const maxSendingDomains = vi.fn<() => number | null>(() => null)
vi.mock('@/lib/server/domains/settings/tier-limits.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/settings/tier-limits.service')>()
  const { OSS_TIER_LIMITS } = await import('@/lib/server/domains/settings/tier-limits.types')
  return {
    ...actual,
    getTierLimits: async () => ({ ...OSS_TIER_LIMITS, maxSendingDomains: maxSendingDomains() }),
  }
})

import { getSendingDomain } from '../channel-account.service'
import {
  provisionSendingDomain,
  refreshSendingDomain,
  restartSendingDomainChecks,
  sweepSendingDomains,
} from '../sending-identity'
import { PROVIDER_RECHECK_MS, WATCH_BUDGET_MS, watchSendingDomains } from '../sending-domain-watch'

const REGION = 'eu-west-2'

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

/** Publish records into the zone as a domain owner following them would. */
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

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailSendingDomains.mailFromLabel }).from(emailSendingDomains).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${suffix()}` })
    .returning()
  return team.id
}

async function seedPerson(role: 'admin' | 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user')
  const principalId = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function bellsFor(people: PrincipalId[], type: string) {
  return testDb
    .select()
    .from(inAppNotifications)
    .where(and(inArray(inAppNotifications.principalId, people), eq(inAppNotifications.type, type)))
}

describe.skipIf(!fixture.available)('sending-domain watch (real DB, rolled back)', () => {
  let teamId: TeamId

  beforeEach(async () => {
    await fixture.begin()
    vi.stubEnv('EMAIL_SES_ACCESS_KEY_ID', 'AKIASEND')
    vi.stubEnv('EMAIL_SES_SECRET_ACCESS_KEY', 'send-secret')
    vi.stubEnv('EMAIL_SMTP_HOST', '')
    vi.stubEnv('EMAIL_RESEND_API_KEY', '')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_SES_REGION', REGION)
    vi.stubEnv('EMAIL_SES_IDENTITY_ACCESS_KEY_ID', 'AKIAIDENT')
    vi.stubEnv('EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY', 'ident-secret')
    vi.stubEnv('EMAIL_FROM', 'Quackback <notifications@mail.platform.test>')
    vi.stubEnv('EMAIL_INBOUND_DOMAIN', 'mail.platform.test')
    providerState.clear()
    zone.clear()
    zoneLookups.length = 0
    getIdentity.mockClear()
    sentAttention.mockReset()
    maxSendingDomains.mockReturnValue(null)
    teamId = await seedTeam()
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  describe('watchSendingDomains', () => {
    it('watches only pending domains inside their window', async () => {
      const inWindow = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      const expired = await provisionSendingDomain({ owningTeamId: teamId, domain: 'b.example' })
      const live = await provisionSendingDomain({ owningTeamId: teamId, domain: 'c.example' })
      await testDb
        .update(emailSendingDomains)
        .set({ autoCheckUntil: new Date(Date.now() - 60_000) })
        .where(eq(emailSendingDomains.id, expired.id))
      await testDb
        .update(emailSendingDomains)
        .set({ status: 'verified' })
        .where(eq(emailSendingDomains.id, live.id))
      getIdentity.mockClear()
      zoneLookups.length = 0

      expect(await watchSendingDomains()).toEqual({ watched: 1, providerChecks: 1 })
      expect(getIdentity.mock.calls.map(([d]) => d)).toEqual(['a.example'])
      expect(zoneLookups.some((l) => l.endsWith('b.example'))).toBe(false)
      expect(zoneLookups.some((l) => l.endsWith('c.example'))).toBe(false)
      expect((await getSendingDomain(inWindow.id))?.dnsRecords[0].check?.state).toBe('missing')
    })

    it('stops when its time budget is spent and leaves the rest for the next tick', async () => {
      await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      await provisionSendingDomain({ owningTeamId: teamId, domain: 'b.example' })
      await provisionSendingDomain({ owningTeamId: teamId, domain: 'c.example' })
      zoneLookups.length = 0
      // The first domain takes the whole budget.
      const clock = vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(0)
      clock.mockReturnValue(WATCH_BUDGET_MS)

      expect((await watchSendingDomains(new Date(), { clock })).watched).toBe(1)
      const looked = new Set(zoneLookups.map((l) => l.split('.').slice(-2).join('.')))
      expect(looked.size).toBe(1)

      // The next tick starts with the ones left unchecked.
      zoneLookups.length = 0
      const next = await watchSendingDomains(new Date(Date.now() + 60_000))
      expect(next.watched).toBe(3)
      const order = [...new Set(zoneLookups.map((l) => l.split('.').slice(-2).join('.')))]
      expect(order[order.length - 1]).toBe([...looked][0])
    })

    it('does nothing at all with nothing pending', async () => {
      expect(await watchSendingDomains()).toEqual({ watched: 0, providerChecks: 0 })
      expect(zoneLookups).toEqual([])
    })

    it('does nothing on a server that cannot provision domains', async () => {
      await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      vi.stubEnv('EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY', '')
      getIdentity.mockClear()
      zoneLookups.length = 0
      expect(await watchSendingDomains()).toEqual({ watched: 0, providerChecks: 0 })
      expect(zoneLookups).toEqual([])
      expect(getIdentity).not.toHaveBeenCalled()
    })

    it('skips the provider when no check changed and its answer is recent', async () => {
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      await refreshSendingDomain(row.id)
      getIdentity.mockClear()

      const now = new Date(Date.now() + 10 * 60 * 1000)
      expect(await watchSendingDomains(now)).toEqual({ watched: 1, providerChecks: 0 })
      expect(getIdentity).not.toHaveBeenCalled()
      // The lookups still ran and were stored.
      const stored = await getSendingDomain(row.id)
      expect(stored?.dnsRecords[0].check?.checkedAt).toBe(now.toISOString())
    })

    it('asks the provider when a record appeared', async () => {
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      const refreshed = await refreshSendingDomain(row.id)
      getIdentity.mockClear()

      publish('a.example', refreshed?.dnsRecords.slice(0, 1) ?? [])
      expect((await watchSendingDomains()).providerChecks).toBe(1)
      expect(getIdentity.mock.calls.map(([d]) => d)).toEqual(['a.example'])
    })

    it('asks the provider every third tick even when nothing changed', async () => {
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      await refreshSendingDomain(row.id)
      getIdentity.mockClear()

      const later = new Date(Date.now() + PROVIDER_RECHECK_MS + 60_000)
      expect((await watchSendingDomains(later)).providerChecks).toBe(1)
      expect(getIdentity).toHaveBeenCalledTimes(1)
    })

    it('turns a domain live once its records are published and the provider agrees', async () => {
      const admin = await seedPerson('admin')
      const member = await seedPerson('member')
      const portalUser = await seedPerson('user')
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      await testDb.insert(channelAccounts).values({
        owningTeamId: teamId,
        role: 'sending',
        address: 'help@a.example',
        module: 'support',
      })
      publish('a.example', row.dnsRecords)
      providerState.set('a.example', verifiedIdentity('a.example'))

      await watchSendingDomains()
      expect((await getSendingDomain(row.id))?.status).toBe('verified')

      const bells = await bellsFor([admin, member, portalUser], 'sending_domain_live')
      expect(bells.map((b) => [b.principalId, b.title])).toEqual([
        [admin, 'help@a.example is live'],
      ])

      // Further checks of a live domain ring nothing more.
      await watchSendingDomains()
      await refreshSendingDomain(row.id)
      expect(await bellsFor([admin], 'sending_domain_live')).toHaveLength(1)
    })
    it('rings the live bell once when two checks see the domain go live together', async () => {
      // The watch job and a person's Verify, at the same moment: both
      // read the row as pending and both find it verified.
      const admin = await seedPerson('admin')
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      await testDb.insert(channelAccounts).values({
        owningTeamId: teamId,
        role: 'sending',
        address: 'help@a.example',
        module: 'support',
      })
      publish('a.example', row.dnsRecords)
      providerState.set('a.example', verifiedIdentity('a.example'))

      const [first, second] = await Promise.all([
        refreshSendingDomain(row.id),
        refreshSendingDomain(row.id),
      ])
      expect(first?.status).toBe('verified')
      expect(second?.status).toBe('verified')
      expect(await bellsFor([admin], 'sending_domain_live')).toHaveLength(1)
    })
  })

  describe('restartSendingDomainChecks', () => {
    it('opens a fresh 72 hour window and checks now', async () => {
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      await testDb
        .update(emailSendingDomains)
        .set({ autoCheckUntil: new Date(Date.now() - 60_000) })
        .where(eq(emailSendingDomains.id, row.id))
      getIdentity.mockClear()

      const before = Date.now()
      const restarted = await restartSendingDomainChecks(row.id)
      const window = (restarted?.autoCheckUntil?.getTime() ?? 0) - before
      expect(window).toBeGreaterThanOrEqual(72 * 3600 * 1000 - 5000)
      expect(window).toBeLessThanOrEqual(72 * 3600 * 1000 + 5000)
      expect(restarted?.lastCheckedAt).not.toBeNull()
      expect(getIdentity.mock.calls.map(([d]) => d)).toEqual(['a.example'])
      expect((await watchSendingDomains()).watched).toBe(1)
    })

    it('answers null for a domain that does not exist', async () => {
      expect(await restartSendingDomainChecks(createId('sending_domain'))).toBeNull()
    })
  })

  describe('a verified domain that stops verifying', () => {
    it('rings once and emails the managers, naming the record that failed', async () => {
      const admin = await seedPerson('admin')
      const member = await seedPerson('member')
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      publish('a.example', row.dnsRecords)
      providerState.set('a.example', verifiedIdentity('a.example'))
      await refreshSendingDomain(row.id)
      expect((await getSendingDomain(row.id))?.status).toBe('verified')

      // The return path MX is removed, and the provider sees it too.
      zone.set('qb-bounce.a.example', { ...zone.get('qb-bounce.a.example'), MX: [] })
      providerState.set('a.example', {
        ...verifiedIdentity('a.example'),
        mailFrom: { domain: 'qb-bounce.a.example', status: 'FAILED' },
      })
      expect((await sweepSendingDomains()).demoted).toBe(1)

      const bells = await bellsFor([admin, member], 'sending_domain_needs_attention')
      expect(bells.map((b) => [b.principalId, b.title, b.body])).toEqual([
        [
          admin,
          'Sending from a.example needs attention',
          'The return path record (MX qb-bounce.a.example) is missing.',
        ],
      ])
      const [adminUser] = await testDb
        .select({ email: user.email })
        .from(principal)
        .innerJoin(user, eq(principal.userId, user.id))
        .where(eq(principal.id, admin))
      const toAdmin = sentAttention.mock.calls.filter(([p]) => p.to === adminUser.email)
      expect(toAdmin).toHaveLength(1)
      expect(toAdmin[0][0]).toMatchObject({
        domain: 'a.example',
        record: { purpose: 'mail-from', type: 'MX', name: 'qb-bounce.a.example', state: 'missing' },
      })

      // The next sweep finds it already demoted, and says nothing again.
      await sweepSendingDomains()
      expect(await bellsFor([admin], 'sending_domain_needs_attention')).toHaveLength(1)
    })

    it('names the signing key when an identity that was already there stops signing', async () => {
      const admin = await seedPerson('admin')
      // The identity existed before this row: it keeps the key it signs with.
      providerState.set('a.example', {
        ...verifiedIdentity('a.example'),
        signingOrigin: 'external',
      })
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      expect(row.dkimMode).toBe('shared')
      publish('a.example', row.dnsRecords)
      await refreshSendingDomain(row.id)
      expect((await getSendingDomain(row.id))?.status).toBe('verified')

      // Every listed record is still in place; the key nobody here lists failed.
      providerState.set('a.example', {
        ...verifiedIdentity('a.example'),
        signingOrigin: 'external',
        dkimStatus: 'FAILED',
      })
      expect((await sweepSendingDomains()).demoted).toBe(1)

      const bells = await bellsFor([admin], 'sending_domain_needs_attention')
      expect(bells.map((b) => b.body)).toEqual(["The signing key for a.example isn't working."])
      expect(sentAttention.mock.calls[0][0]).toMatchObject({ record: 'signing-key' })
    })
  })
})
