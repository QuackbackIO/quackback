/**
 * The ownership watch on domains added by name, against a real database rolled
 * back after each test.
 *
 * A verified domain whose record goes missing keeps its proof for the same
 * grace period as a sending domain, with the same warning, and is demoted only
 * when the record is still gone after it. Demotion then takes verification
 * off the sign-in domains that rested on it alone, and never off one that
 * holds its own `_quackback-verify` record or another proof.
 *
 * The zone is a fake resolver that answers only for what a test publishes, can
 * be made to fail a lookup, and records every name it is asked about. The
 * notices are recorded rather than sent.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  domains,
  emailSendingDomains,
  eq,
  settings,
  ssoVerifiedDomain,
  teams,
  type Domain,
  type SendingDomainDnsRecord,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const zone = vi.hoisted(() => ({
  published: new Map<string, string[]>(),
  failing: new Set<string>(),
  asked: [] as string[],
}))
vi.mock('@/lib/server/dns/resolver', () => {
  const resolver = {
    resolveTxt: async (name: string) => {
      zone.asked.push(name)
      if (zone.failing.has(name)) {
        throw Object.assign(new Error(`ETIMEOUT ${name}`), { code: 'ETIMEOUT' })
      }
      const values = zone.published.get(name)
      if (!values) throw Object.assign(new Error(`ENODATA ${name}`), { code: 'ENODATA' })
      return values.map((v) => [v])
    },
  }
  return { systemResolver: resolver, interactiveResolver: resolver }
})

const notices = vi.hoisted(() => ({
  warned: [] as { name: string; deadline: Date }[],
  demoted: [] as { name: string; signIn: string[] }[],
  deliver: true,
}))
vi.mock('../domain-ownership-notify', () => ({
  notifyDomainOwnershipMissing: async (domain: { name: string }, deadline: Date) => {
    notices.warned.push({ name: domain.name, deadline })
    return notices.deliver
  },
  notifyDomainOwnershipLapsed: async (domain: { name: string }, signIn: string[]) => {
    notices.demoted.push({ name: domain.name, signIn })
  },
}))

const auth = vi.hoisted(() => ({ resets: 0 }))
vi.mock('@/lib/server/auth', () => ({
  resetAuth: () => {
    auth.resets += 1
  },
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => {},
}))

import { watchDomainOwnership } from '../domain-ownership-watch'
import { ssoDomainProvenBy } from '../proven-zones'
import {
  OWNERSHIP_GRACE_SLACK_MS,
  ownershipGraceEnds,
} from '../../channel-accounts/ownership-grace'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ c: domains.ownershipWarningSentAt }).from(domains).limit(0)
    await db.select({ id: ssoVerifiedDomain.id }).from(ssoVerifiedDomain).limit(0)
    await db.select({ id: emailSendingDomains.dkimMode }).from(emailSendingDomains).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const ownershipValue = (token: string) => `quackback-domain-verification=${token}`

async function seedDomain(name: string, status: 'pending' | 'verified' = 'verified') {
  const [row] = await testDb
    .insert(domains)
    .values({
      name,
      ownershipToken: `${suffix()}${suffix()}`.replace(/[^0-9a-z]/g, ''),
      status,
      verifiedAt: status === 'verified' ? new Date('2026-10-01T00:00:00Z') : null,
    })
    .returning()
  return row
}

const publishOwnership = (row: Domain) =>
  zone.published.set(`_quackback.${row.name}`, [ownershipValue(row.ownershipToken)])

async function seedSso(name: string) {
  const [row] = await testDb
    .insert(ssoVerifiedDomain)
    .values({ name, verificationToken: `T${suffix()}`, verifiedAt: new Date('2026-10-02') })
    .returning()
  return row
}

const read = async (row: Domain) =>
  (await testDb.select().from(domains).where(eq(domains.id, row.id)))[0]
const ssoVerified = async (id: string) =>
  (
    await testDb
      .select()
      .from(ssoVerifiedDomain)
      .where(eq(ssoVerifiedDomain.id, id as never))
  )[0]?.verifiedAt !== null

/** A sweep at the moment just past the grace period that started at `since`. */
const afterGrace = (since: Date) =>
  new Date(ownershipGraceEnds(since).getTime() - OWNERSHIP_GRACE_SLACK_MS + 1)

/** Miss the record once, then sweep again once the period is over. */
async function lapse(row: Domain): Promise<Date> {
  const since = new Date('2026-11-01T06:00:00Z')
  await watchDomainOwnership(since)
  expect((await read(row)).ownershipMissingSince).toEqual(since)
  await watchDomainOwnership(afterGrace(since))
  return since
}

describe.skipIf(!fixture.available)('domain ownership watch (real DB, rolled back)', () => {
  beforeEach(async () => {
    zone.published.clear()
    zone.failing.clear()
    zone.asked.length = 0
    notices.warned.length = 0
    notices.demoted.length = 0
    notices.deliver = true
    auth.resets = 0
    await fixture.begin()
    await testDb.insert(settings).values({
      name: 'Acme',
      slug: `acme-${suffix()}`,
      createdAt: new Date(),
    })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('reads each verified domain’s own record, and leaves pending ones alone', async () => {
    const row = await seedDomain('acme.com')
    await seedDomain('pending.acme.io', 'pending')
    publishOwnership(row)

    await watchDomainOwnership()

    expect(zone.asked).toEqual(['_quackback.acme.com'])
    const after = await read(row)
    expect(after.status).toBe('verified')
    expect(after.ownershipMissingSince).toBeNull()
    expect(after.lastCheckedAt).toBeInstanceOf(Date)
    expect(notices.warned).toEqual([])
  })

  it('starts the grace period on a missing record, warns once, and keeps the proof', async () => {
    const row = await seedDomain('acme.com')
    const sso = await seedSso('acme.com')
    const now = new Date('2026-11-01T06:00:00Z')

    await watchDomainOwnership(now)
    await watchDomainOwnership(new Date('2026-11-02T06:00:00Z'))

    const after = await read(row)
    expect(after.status).toBe('verified')
    expect(after.ownershipMissingSince).toEqual(now)
    expect(after.ownershipWarningSentAt).toBeInstanceOf(Date)
    expect(notices.warned).toEqual([{ name: 'acme.com', deadline: ownershipGraceEnds(now) }])
    expect(await ssoVerified(sso.id)).toBe(true)
  })

  it('tries a warning that was not delivered again on the next check', async () => {
    await seedDomain('acme.com')
    notices.deliver = false
    await watchDomainOwnership(new Date('2026-11-01T06:00:00Z'))
    notices.deliver = true
    await watchDomainOwnership(new Date('2026-11-02T06:00:00Z'))
    await watchDomainOwnership(new Date('2026-11-03T06:00:00Z'))

    expect(notices.warned).toHaveLength(2)
  })

  it('counts another row’s token as missing, never as its own', async () => {
    const row = await seedDomain('acme.com')
    zone.published.set('_quackback.acme.com', [ownershipValue('someone-elses-token')])

    await watchDomainOwnership(new Date('2026-11-01T06:00:00Z'))

    expect((await read(row)).ownershipMissingSince).not.toBeNull()
  })

  it('starts nothing when the lookup goes unanswered', async () => {
    const row = await seedDomain('acme.com')
    zone.failing.add('_quackback.acme.com')

    await watchDomainOwnership(new Date('2026-11-01T06:00:00Z'))

    expect((await read(row)).ownershipMissingSince).toBeNull()
    expect(notices.warned).toEqual([])
  })

  it('ends the period when the record is back', async () => {
    const row = await seedDomain('acme.com')
    const since = new Date('2026-11-01T06:00:00Z')
    await watchDomainOwnership(since)
    publishOwnership(row)

    await watchDomainOwnership(afterGrace(since))

    const after = await read(row)
    expect(after.status).toBe('verified')
    expect(after.ownershipMissingSince).toBeNull()
    expect(after.ownershipWarningSentAt).toBeNull()
    expect(notices.demoted).toEqual([])
  })

  it('demotes after the period, and only then takes verification off sign-in domains it proved', async () => {
    const row = await seedDomain('acme.com')
    const apex = await seedSso('acme.com')
    const eu = await seedSso('eu.acme.com')
    const elsewhere = await seedSso('acme.io')

    const since = new Date('2026-11-01T06:00:00Z')
    await watchDomainOwnership(since)
    // Still inside the period: nothing is taken away yet.
    await watchDomainOwnership(new Date(afterGrace(since).getTime() - 2 * 60 * 60 * 1000))
    expect((await read(row)).status).toBe('verified')
    expect(await ssoVerified(apex.id)).toBe(true)

    await watchDomainOwnership(afterGrace(since))

    const after = await read(row)
    expect(after.status).toBe('pending')
    expect(after.ownershipMissingSince).toBeNull()
    expect(await ssoVerified(apex.id)).toBe(false)
    expect(await ssoVerified(eu.id)).toBe(false)
    expect(await ssoVerified(elsewhere.id)).toBe(true)
    expect(notices.demoted).toEqual([{ name: 'acme.com', signIn: ['acme.com', 'eu.acme.com'] }])
    // Sign-in rebuilds with the change.
    expect(auth.resets).toBe(1)
  })

  it('never takes verification off a sign-in domain that holds its own record', async () => {
    const row = await seedDomain('acme.com')
    const sso = await seedSso('eu.acme.com')
    zone.published.set('_quackback-verify.eu.acme.com', [
      `qb-domain-verify=${sso.verificationToken}`,
    ])

    await lapse(row)

    expect((await read(row)).status).toBe('pending')
    expect(await ssoVerified(sso.id)).toBe(true)
    expect(notices.demoted).toEqual([{ name: 'acme.com', signIn: [] }])
    expect(auth.resets).toBe(0)
  })

  it('takes it off a sign-in domain whose own record holds another token', async () => {
    const row = await seedDomain('acme.com')
    const sso = await seedSso('acme.com')
    zone.published.set('_quackback-verify.acme.com', ['qb-domain-verify=someone-else'])

    await lapse(row)

    expect(await ssoVerified(sso.id)).toBe(false)
  })

  it('keeps a sign-in domain another proof still covers', async () => {
    const row = await seedDomain('acme.com')
    const underParent = await seedSso('eu.acme.com')
    // A second verified domain that also covers the sign-in domain, still published.
    const nearer = await seedDomain('eu.acme.com')
    publishOwnership(nearer)

    await lapse(row)

    expect((await read(row)).status).toBe('pending')
    expect(await ssoVerified(underParent.id)).toBe(true)
  })

  it('does not count a sending row that rests on the same missing record', async () => {
    const row = await seedDomain('acme.com')
    const [team] = await testDb.insert(teams).values({ name: 'Support' }).returning()
    const record: SendingDomainDnsRecord = {
      type: 'TXT',
      host: '_quackback',
      value: ownershipValue(row.ownershipToken),
      purpose: 'ownership',
    }
    await testDb.insert(emailSendingDomains).values({
      owningTeamId: team.id as TeamId,
      domain: 'acme.com',
      status: 'verified',
      dkimMode: 'easy',
      verifiedAt: new Date(),
      dnsRecords: [record],
    })
    const sso = await seedSso('acme.com')

    await lapse(row)

    expect(await ssoVerified(sso.id)).toBe(false)
  })

  it('demotes anyway when a sign-in domain’s own lookup goes unanswered, and judges it on a later run', async () => {
    const row = await seedDomain('acme.com')
    const unanswered = await seedSso('acme.com')
    const judged = await seedSso('eu.acme.com')
    zone.failing.add('_quackback-verify.acme.com')

    const since = await lapse(row)
    // A failed lookup never keeps a lapsed proof alive.
    expect((await read(row)).status).toBe('pending')
    expect(await ssoDomainProvenBy('www.acme.com')).toBeNull()
    expect(await ssoVerified(judged.id)).toBe(false)
    expect(await ssoVerified(unanswered.id)).toBe(true)

    // Still unanswered: still left alone, still re-judged.
    await watchDomainOwnership(new Date(afterGrace(since).getTime() + 60_000))
    expect(await ssoVerified(unanswered.id)).toBe(true)

    zone.failing.clear()
    await watchDomainOwnership(new Date(afterGrace(since).getTime() + 120_000))
    expect(await ssoVerified(unanswered.id)).toBe(false)
    expect(notices.demoted.at(-1)).toEqual({ name: 'acme.com', signIn: ['acme.com'] })
  })

  it('stops counting a sending row that shares the token once the domain is demoted, and starts its grace', async () => {
    const row = await seedDomain('acme.com')
    const [team] = await testDb.insert(teams).values({ name: 'Support' }).returning()
    const [twin] = await testDb
      .insert(emailSendingDomains)
      .values({
        owningTeamId: team.id as TeamId,
        domain: 'acme.com',
        status: 'verified',
        dkimMode: 'easy',
        verifiedAt: new Date(),
        dnsRecords: [
          {
            type: 'TXT',
            host: '_quackback',
            value: ownershipValue(row.ownershipToken),
            purpose: 'ownership',
          },
        ],
      })
      .returning()

    const since = await lapse(row)

    expect((await read(row)).status).toBe('pending')
    // The twin can no longer prove a new sign-in domain with no record anywhere.
    expect(await ssoDomainProvenBy('acme.com')).toBeNull()
    const [after] = await testDb
      .select()
      .from(emailSendingDomains)
      .where(eq(emailSendingDomains.id, twin.id))
    expect(after.ownershipMissingSince).toEqual(since)
  })

  it("never touches another workspace's sign-in domains", async () => {
    await seedDomain('acme.com')
    await fixture.rollback()
    await fixture.begin()
    const sso = await seedSso('acme.com')

    const since = new Date('2026-11-01T06:00:00Z')
    await watchDomainOwnership(since)
    await watchDomainOwnership(afterGrace(since))

    expect(zone.asked).toEqual([])
    expect(await ssoVerified(sso.id)).toBe(true)
  })
})
