/**
 * The daily re-check of self-hosted section hostnames, against a real database
 * rolled back after each test.
 *
 * A verified hostname that stops reaching this server is marked unconfirmed
 * (sign-in stops at once, routing keeps its grace) and the people who manage
 * domains are told; one that answers again is confirmed again; one still
 * failing when the grace is over stops being verified. A single miss is
 * checked once more before anything changes, so a blink on this server's own
 * network marks nothing.
 *
 * The probe is a fake that answers per hostname from a script; the notices are
 * recorded rather than sent.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings } from '@/lib/server/db'
import { UNCONFIRMED_GRACE_MS, type SectionDomainMap } from '@/lib/shared/section-domains'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheGet: async () => null,
  cacheSet: async () => {},
  cacheDel: async () => {},
}))
vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  getBaseUrl: () => 'https://feedback.acme.com',
}))

type Outcome = 'ok' | 'unanswered' | 'refused'
const probe = vi.hoisted(() => ({
  /** Per hostname, the outcome of each probe in turn; the last one repeats. */
  script: new Map<string, Outcome[]>(),
  asked: [] as string[],
  /** Run once, while the first probe of the run is in flight. */
  during: null as null | (() => Promise<void>),
}))
vi.mock('@/lib/server/domains/domain-proof/reachability-probe', () => ({
  probeCustomDomain: async (hostname: string) => {
    probe.asked.push(hostname)
    const during = probe.during
    probe.during = null
    if (during) await during()
    const outcomes = probe.script.get(hostname) ?? ['ok']
    const outcome = outcomes.length > 1 ? outcomes.shift()! : outcomes[0]
    if (outcome === 'ok') {
      return {
        status: { dnsResolved: true, instanceReachable: true, verified: true },
        dnsAnswered: true,
      }
    }
    return {
      status: {
        dnsResolved: outcome === 'refused',
        instanceReachable: false,
        verified: false,
      },
      dnsAnswered: outcome === 'refused',
    }
  },
}))

const notices = vi.hoisted(() => ({
  notAnswering: [] as { hostname: string; deadline: Date }[],
  lapsed: [] as string[],
}))
vi.mock('../section-domains-notify', () => ({
  notifySectionDomainNotAnswering: async (_section: string, hostname: string, deadline: Date) => {
    notices.notAnswering.push({ hostname, deadline })
  },
  notifySectionDomainLapsed: async (_section: string, hostname: string) => {
    notices.lapsed.push(hostname)
  },
}))

const { watchSectionDomains } = await import('../section-domains-watch')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ c: settings.cloudIdentity }).from(settings).limit(0)
  },
})

const NOW = new Date('2026-11-16T07:00:00.000Z')
const VERIFIED = '2026-10-01T00:00:00.000Z'
const DAY = 24 * 60 * 60 * 1000
const noWait = async () => {}
const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seed(map: SectionDomainMap, values: Partial<typeof settings.$inferInsert> = {}) {
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: `acme-${suffix()}`,
    createdAt: new Date(),
    portalConfig: JSON.stringify({ sectionDomains: map }),
    ...values,
  })
}

async function stored(): Promise<SectionDomainMap> {
  const [row] = await testDb.select({ portal: settings.portalConfig }).from(settings).limit(1)
  return JSON.parse(row!.portal!).sectionDomains
}

const run = () => watchSectionDomains(NOW, { wait: noWait })

describe.skipIf(!fixture.available)('section domain watch (real DB, rolled back)', () => {
  beforeEach(async () => {
    probe.script = new Map()
    probe.asked = []
    probe.during = null
    notices.notAnswering = []
    notices.lapsed = []
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('checks only verified hostnames, and leaves one that still answers as it was', async () => {
    await seed({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED },
      status: { hostname: 'status.acme.com', verifiedAt: null },
    })

    const result = await run()

    expect(probe.asked).toEqual(['help.acme.com'])
    expect(result).toEqual({ checked: 1, unconfirmed: 0, confirmed: 0, lapsed: 0 })
    expect(await stored()).toEqual({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED },
      status: { hostname: 'status.acme.com', verifiedAt: null },
    })
    expect(notices.notAnswering).toEqual([])
  })

  it('marks a hostname whose lookups go unanswered, keeping its verification, and tells the managers', async () => {
    await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
    probe.script.set('help.acme.com', ['unanswered'])

    const result = await run()

    expect(result.unconfirmed).toBe(1)
    expect(await stored()).toEqual({
      help: {
        hostname: 'help.acme.com',
        verifiedAt: VERIFIED,
        unconfirmedSince: NOW.toISOString(),
      },
    })
    expect(notices.notAnswering).toEqual([
      { hostname: 'help.acme.com', deadline: new Date(NOW.getTime() + UNCONFIRMED_GRACE_MS) },
    ])
  })

  it('marks a hostname that resolves but no longer reaches this server the same way', async () => {
    await seed({ status: { hostname: 'status.acme.com', verifiedAt: VERIFIED } })
    probe.script.set('status.acme.com', ['refused'])

    await run()

    expect((await stored()).status).toEqual({
      hostname: 'status.acme.com',
      verifiedAt: VERIFIED,
      unconfirmedSince: NOW.toISOString(),
    })
  })

  it('checks a miss once more, and changes nothing when the second check answers', async () => {
    await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
    probe.script.set('help.acme.com', ['unanswered', 'ok'])

    const result = await run()

    expect(probe.asked).toEqual(['help.acme.com', 'help.acme.com'])
    expect(result.unconfirmed).toBe(0)
    expect(await stored()).toEqual({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
    expect(notices.notAnswering).toEqual([])
  })

  it('confirms again a marked hostname that answers, keeping when it was verified', async () => {
    const since = new Date(NOW.getTime() - 2 * DAY).toISOString()
    await seed({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, unconfirmedSince: since },
    })

    const result = await run()

    expect(result.confirmed).toBe(1)
    expect(await stored()).toEqual({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
  })

  it('keeps the first mark and tells nobody again while the grace runs', async () => {
    const since = new Date(NOW.getTime() - 2 * DAY).toISOString()
    await seed({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, unconfirmedSince: since },
    })
    probe.script.set('help.acme.com', ['unanswered'])

    await run()

    expect((await stored()).help?.unconfirmedSince).toBe(since)
    expect(notices.notAnswering).toEqual([])
    expect(notices.lapsed).toEqual([])
  })

  it('stops verifying a hostname still failing when the grace is over, and says so', async () => {
    const since = new Date(NOW.getTime() - UNCONFIRMED_GRACE_MS - 1).toISOString()
    await seed({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, unconfirmedSince: since },
      status: { hostname: 'status.acme.com', verifiedAt: VERIFIED },
    })
    probe.script.set('help.acme.com', ['refused'])

    const result = await run()

    expect(result.lapsed).toBe(1)
    expect(await stored()).toEqual({
      help: { hostname: 'help.acme.com', verifiedAt: null },
      status: { hostname: 'status.acme.com', verifiedAt: VERIFIED },
    })
    expect(notices.lapsed).toEqual(['help.acme.com'])
  })

  it('keeps a hostname whose grace ends exactly now, as routing does', async () => {
    const since = new Date(NOW.getTime() - UNCONFIRMED_GRACE_MS).toISOString()
    await seed({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, unconfirmedSince: since },
    })
    probe.script.set('help.acme.com', ['refused'])

    expect((await run()).lapsed).toBe(0)
    expect((await stored()).help?.verifiedAt).toBe(VERIFIED)
  })

  it('never overwrites a section an admin changed while its hostname was being checked', async () => {
    await seed({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED },
      status: { hostname: 'status.acme.com', verifiedAt: VERIFIED },
    })
    probe.script.set('help.acme.com', ['unanswered'])
    probe.script.set('status.acme.com', ['unanswered'])
    probe.during = async () => {
      const map = await stored()
      map.help = { hostname: 'support.acme.com', verifiedAt: null }
      await testDb.update(settings).set({ portalConfig: JSON.stringify({ sectionDomains: map }) })
    }

    await run()

    expect(await stored()).toEqual({
      help: { hostname: 'support.acme.com', verifiedAt: null },
      status: {
        hostname: 'status.acme.com',
        verifiedAt: VERIFIED,
        unconfirmedSince: NOW.toISOString(),
      },
    })
    expect(notices.notAnswering.map((n) => n.hostname)).toEqual(['status.acme.com'])
  })

  it('checks the help center domain kept only in its own setting', async () => {
    await seed(
      {},
      {
        portalConfig: null,
        helpCenterConfig: JSON.stringify({
          enabled: true,
          domain: { domain: 'help.acme.com', verifiedAt: VERIFIED },
        }),
      }
    )
    probe.script.set('help.acme.com', ['unanswered'])

    await run()

    expect((await stored()).help).toEqual({
      hostname: 'help.acme.com',
      verifiedAt: VERIFIED,
      unconfirmedSince: NOW.toISOString(),
    })
  })

  it('does nothing on a server not yet set up, which has no settings row', async () => {
    await testDb.delete(settings)

    expect(await run()).toEqual({ checked: 0, unconfirmed: 0, confirmed: 0, lapsed: 0 })
    expect(probe.asked).toEqual([])
  })

  it('leaves Cloud alone: there the control plane decides when a domain is ready', async () => {
    await seed(
      { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
      { cloud: { enabled: true } as typeof settings.$inferInsert.cloud }
    )
    probe.script.set('help.acme.com', ['unanswered'])

    expect(await run()).toEqual({ checked: 0, unconfirmed: 0, confirmed: 0, lapsed: 0 })
    expect(probe.asked).toEqual([])
    expect(await stored()).toEqual({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
  })
})
