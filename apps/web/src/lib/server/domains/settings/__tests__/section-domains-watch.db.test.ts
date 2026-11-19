/**
 * The daily re-check of self-hosted section hostnames, against a real database
 * rolled back after each test.
 *
 * A verified hostname that fails on two daily runs in a row (no address,
 * something else answering, or its verification record gone) is marked
 * unconfirmed (sign-in stops at once, routing keeps its grace) and the people
 * who manage domains are told; the first run only notes the miss. One that
 * answers again is confirmed again; one still failing when the grace is over
 * stops being verified. A miss is checked once more within a run, so a blink
 * on this server's own network notes nothing.
 *
 * A check that only could not reach this server through the hostname, while
 * the workspace's verification record still covers it, or whose lookups went
 * unanswered, leaves a warning and nothing else: no miss, no mark, no grace.
 *
 * The probe is a fake that answers per hostname from a script, the zone's TXT
 * records are a fake behind the shared resolver, and the notices are recorded
 * rather than sent. The verification records are real rows.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { domains, settings } from '@/lib/server/db'
import {
  UNCONFIRMED_GRACE_MS,
  confirmedSectionDomains,
  type SectionDomainMap,
} from '@/lib/shared/section-domains'
import { ownershipRecord } from '@/lib/server/domains/channel-accounts/sending-domain-records'
import { routableSectionDomains } from '../section-domains.hosting'

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

/**
 * - ok: this server answers.
 * - unanswered: the address lookups went unanswered.
 * - absent: the zone says the hostname has no address.
 * - refused: it resolves, and nothing answers there.
 * - other: it resolves, and a server that is not this one answers.
 */
type Outcome = 'ok' | 'unanswered' | 'absent' | 'refused' | 'other'
const probe = vi.hoisted(() => ({
  /** Per hostname, the outcome of each probe in turn; the last one repeats. */
  script: new Map<string, Outcome[]>(),
  asked: [] as string[],
  /** The primary host each probe was handed, for the shared-address rule. */
  primaryHosts: [] as (string | null | undefined)[],
  /** Run once, while the first probe of the run is in flight. */
  during: null as null | (() => Promise<void>),
}))
vi.mock('@/lib/server/domains/domain-proof/reachability-probe', () => ({
  probeCustomDomain: async (hostname: string, opts?: { primaryOrigin?: string | null }) => {
    probe.asked.push(hostname)
    probe.primaryHosts.push(opts?.primaryOrigin)
    const during = probe.during
    probe.during = null
    if (during) await during()
    const outcomes = probe.script.get(hostname) ?? ['ok']
    const outcome = outcomes.length > 1 ? outcomes.shift()! : outcomes[0]
    if (outcome === 'ok') {
      return {
        status: { dnsResolved: true, instanceReachable: true, verified: true },
        dnsAnswered: true,
        dns: 'resolved',
        instance: 'ok',
      }
    }
    const dns = outcome === 'unanswered' ? 'unknown' : outcome === 'absent' ? 'absent' : 'resolved'
    return {
      status: { dnsResolved: dns === 'resolved', instanceReachable: false, verified: false },
      dnsAnswered: dns !== 'unknown',
      dns,
      instance: outcome === 'other' ? 'other' : 'unreachable',
    }
  },
}))

/** The zone's TXT records by name: each record as the strings it was published in. */
const zone = vi.hoisted(() => ({
  txt: new Map<string, string[][] | 'timeout'>(),
  asked: [] as string[],
}))
vi.mock('@/lib/server/dns/resolver', () => {
  const fail = (code: string) => Object.assign(new Error(code), { code })
  const resolveTxt = async (name: string) => {
    zone.asked.push(name)
    const records = zone.txt.get(name)
    if (records === 'timeout') throw fail('ETIMEOUT')
    if (!records) throw fail('ENOTFOUND')
    return records
  }
  const none = async () => {
    throw fail('ENODATA')
  }
  const resolver = {
    resolveTxt,
    resolveCname: none,
    resolveMx: none,
    resolve4: none,
    resolve6: none,
    resolveNs: none,
  }
  return {
    interactiveResolver: resolver,
    systemResolver: { ...resolver, resolveTxt: none },
  }
})

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
const { isSectionDomainsWatchDue } = await import('../section-domains-watch-queue')
const { JOB_DEFINITIONS } = await import('@/lib/server/jobs/definitions')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ c: settings.cloudIdentity }).from(settings).limit(0)
  },
})

const NOW = new Date('2026-11-16T07:00:00.000Z')
const VERIFIED = '2026-10-01T00:00:00.000Z'
const DAY = 24 * 60 * 60 * 1000
/** A first miss from yesterday's run. */
const MISSED_YESTERDAY = new Date(NOW.getTime() - DAY).toISOString()
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
    probe.primaryHosts = []
    probe.during = null
    zone.txt = new Map()
    zone.asked = []
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
    expect(result).toEqual({
      checked: 1,
      missed: 0,
      unconfirmed: 0,
      confirmed: 0,
      lapsed: 0,
      warned: 0,
    })
    expect(await stored()).toEqual({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED },
      status: { hostname: 'status.acme.com', verifiedAt: null },
    })
    expect(notices.notAnswering).toEqual([])
  })

  it('only notes a first miss: no mark, no notice, sign-in untouched', async () => {
    await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
    probe.script.set('help.acme.com', ['absent'])

    const result = await run()

    expect(result).toMatchObject({ missed: 1, unconfirmed: 0 })
    expect(await stored()).toEqual({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, missedAt: NOW.toISOString() },
    })
    expect(notices.notAnswering).toEqual([])
  })

  it('marks a hostname with no address on a second daily run, and tells the managers', async () => {
    await seed({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, missedAt: MISSED_YESTERDAY },
    })
    probe.script.set('help.acme.com', ['absent'])

    const result = await run()

    expect(result.unconfirmed).toBe(1)
    expect(await stored()).toEqual({
      help: {
        hostname: 'help.acme.com',
        verifiedAt: VERIFIED,
        unconfirmedSince: NOW.toISOString(),
      },
    })
    // The grace counts from the mark, not the first miss.
    expect(notices.notAnswering).toEqual([
      { hostname: 'help.acme.com', deadline: new Date(NOW.getTime() + UNCONFIRMED_GRACE_MS) },
    ])
  })

  it('marks a hostname that resolves but no longer reaches this server, with no verification record, the same way', async () => {
    await seed({
      status: { hostname: 'status.acme.com', verifiedAt: VERIFIED, missedAt: MISSED_YESTERDAY },
    })
    probe.script.set('status.acme.com', ['refused'])

    await run()

    expect((await stored()).status).toEqual({
      hostname: 'status.acme.com',
      verifiedAt: VERIFIED,
      unconfirmedSince: NOW.toISOString(),
    })
  })

  it('never takes a retry of the same run for the second miss', async () => {
    const earlierToday = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
    await seed({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, missedAt: earlierToday },
    })
    probe.script.set('help.acme.com', ['absent'])

    expect((await run()).unconfirmed).toBe(0)
    expect(await stored()).toEqual({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, missedAt: earlierToday },
    })
    expect(notices.notAnswering).toEqual([])
  })

  it('marks nothing on a first miss that was cleared while the hostname was being checked', async () => {
    await seed({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, missedAt: MISSED_YESTERDAY },
    })
    probe.script.set('help.acme.com', ['absent'])
    // Another run, which reached the hostname, cleared the first miss meanwhile.
    probe.during = async () => {
      await testDb.update(settings).set({
        portalConfig: JSON.stringify({
          sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
        }),
      })
    }

    expect((await run()).unconfirmed).toBe(0)
    expect(await stored()).toEqual({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
    expect(notices.notAnswering).toEqual([])
  })

  it('forgets a first miss when the next run answers', async () => {
    await seed({
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, missedAt: MISSED_YESTERDAY },
    })

    await run()

    expect(await stored()).toEqual({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
  })

  it("hands the probe the primary domain's host, so a hairpin install is not a miss", async () => {
    await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
    await run()
    expect(probe.primaryHosts).toEqual(['https://feedback.acme.com'])
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
    probe.script.set('help.acme.com', ['absent'])

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
    probe.script.set('help.acme.com', ['absent'])
    probe.script.set('status.acme.com', ['absent'])
    // Both missed yesterday too, so this run would mark both.
    const map = await stored()
    map.help = { ...map.help!, missedAt: MISSED_YESTERDAY }
    map.status = { ...map.status!, missedAt: MISSED_YESTERDAY }
    await testDb.update(settings).set({ portalConfig: JSON.stringify({ sectionDomains: map }) })
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
    probe.script.set('help.acme.com', ['absent'])

    await run()

    expect((await stored()).help).toEqual({
      hostname: 'help.acme.com',
      verifiedAt: VERIFIED,
      missedAt: NOW.toISOString(),
    })
  })

  describe('a check that cannot say the hostname stopped being ours', () => {
    const RECORD = ownershipRecord('tok-acme')
    const RECORD_NAME = '_quackback.acme.com'

    /** acme.com verified on Settings > Domains, its record published (or not) in the zone. */
    async function verifiedZone(published: string[][] | 'timeout' | null = [[RECORD.value]]) {
      await testDb.insert(domains).values({
        name: 'acme.com',
        ownershipToken: 'tok-acme',
        status: 'verified',
        verifiedAt: new Date(VERIFIED),
      })
      if (published) zone.txt.set(RECORD_NAME, published)
    }

    /** What sign-in and routing make of the stored map now. */
    async function inUse(at: Date = NOW) {
      const map = await stored()
      return {
        signIn: confirmedSectionDomains(map).help?.verifiedAt ?? null,
        routing:
          routableSectionDomains(map, { cloud: false, projection: null }, at.getTime()).help
            ?.verifiedAt ?? null,
      }
    }

    it('only warns when this server cannot reach itself but the verification record holds', async () => {
      await verifiedZone()
      await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
      probe.script.set('help.acme.com', ['refused'])

      const result = await run()

      expect(result).toMatchObject({ warned: 1, missed: 0, unconfirmed: 0 })
      expect(zone.asked).toEqual([RECORD_NAME])
      expect(await stored()).toEqual({
        help: {
          hostname: 'help.acme.com',
          verifiedAt: VERIFIED,
          reachWarning: { reason: 'unreachable', since: NOW.toISOString() },
        },
      })
      expect(await inUse()).toEqual({ signIn: VERIFIED, routing: VERIFIED })
      expect(notices.notAnswering).toEqual([])
    })

    it('never starts the clock however many days it goes on', async () => {
      await verifiedZone()
      await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
      probe.script.set('help.acme.com', ['refused'])

      for (let day = 0; day < 10; day++) {
        await watchSectionDomains(new Date(NOW.getTime() + day * DAY), { wait: noWait })
      }

      const later = new Date(NOW.getTime() + 10 * DAY)
      expect(await stored()).toEqual({
        help: {
          hostname: 'help.acme.com',
          verifiedAt: VERIFIED,
          reachWarning: { reason: 'unreachable', since: NOW.toISOString() },
        },
      })
      expect(await inUse(later)).toEqual({ signIn: VERIFIED, routing: VERIFIED })
      expect(notices.notAnswering).toEqual([])
      expect(notices.lapsed).toEqual([])
    })

    it('reads a long verification record published as several strings whole', async () => {
      const longToken = 'k'.repeat(400)
      await testDb.insert(domains).values({
        name: 'acme.com',
        ownershipToken: longToken,
        status: 'verified',
        verifiedAt: new Date(VERIFIED),
      })
      const value = ownershipRecord(longToken).value
      zone.txt.set(RECORD_NAME, [[value.slice(0, 255), value.slice(255)]])
      await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
      probe.script.set('help.acme.com', ['refused'])

      expect(await run()).toMatchObject({ warned: 1, missed: 0 })
    })

    it('keeps the grace when the verification record is gone', async () => {
      await verifiedZone(null)
      await seed({
        help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, missedAt: MISSED_YESTERDAY },
      })
      probe.script.set('help.acme.com', ['refused'])

      expect(await run()).toMatchObject({ unconfirmed: 1, warned: 0 })
      expect((await stored()).help?.unconfirmedSince).toBe(NOW.toISOString())
      expect((await inUse()).signIn).toBeNull()
      expect(notices.notAnswering.map((n) => n.hostname)).toEqual(['help.acme.com'])
    })

    it('keeps the grace when the record no longer matches', async () => {
      await verifiedZone([[ownershipRecord('tok-someone-else').value]])
      await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
      probe.script.set('help.acme.com', ['refused'])

      expect(await run()).toMatchObject({ missed: 1, warned: 0 })
    })

    it('keeps the grace when another server answers, even with the record published', async () => {
      await verifiedZone()
      await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
      probe.script.set('help.acme.com', ['other'])

      expect(await run()).toMatchObject({ missed: 1, warned: 0 })
      expect(zone.asked).toEqual([])
    })

    it('keeps the grace when the hostname has no address, even with the record published', async () => {
      await verifiedZone()
      await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
      probe.script.set('help.acme.com', ['absent'])

      expect(await run()).toMatchObject({ missed: 1, warned: 0 })
    })

    it('only warns when the address lookups go unanswered, day after day', async () => {
      await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
      probe.script.set('help.acme.com', ['unanswered'])

      for (let day = 0; day < 10; day++) {
        await watchSectionDomains(new Date(NOW.getTime() + day * DAY), { wait: noWait })
      }

      expect(await stored()).toEqual({
        help: {
          hostname: 'help.acme.com',
          verifiedAt: VERIFIED,
          reachWarning: { reason: 'dns', since: NOW.toISOString() },
        },
      })
      expect(await inUse(new Date(NOW.getTime() + 10 * DAY))).toEqual({
        signIn: VERIFIED,
        routing: VERIFIED,
      })
      expect(notices.notAnswering).toEqual([])
    })

    it('only warns when the verification record lookup goes unanswered', async () => {
      await verifiedZone('timeout')
      await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
      probe.script.set('help.acme.com', ['refused'])

      expect(await run()).toMatchObject({ warned: 1, missed: 0 })
      expect((await stored()).help?.reachWarning?.reason).toBe('dns')
    })

    it('leaves a mark and its grace as they were when the lookups go unanswered', async () => {
      const since = new Date(NOW.getTime() - UNCONFIRMED_GRACE_MS - 1).toISOString()
      await seed({
        help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, unconfirmedSince: since },
      })
      probe.script.set('help.acme.com', ['unanswered'])

      expect(await run()).toMatchObject({ lapsed: 0, warned: 0 })
      expect(await stored()).toEqual({
        help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, unconfirmedSince: since },
      })
    })

    it('ends a mark once the verification record is found again', async () => {
      await verifiedZone()
      const since = new Date(NOW.getTime() - 2 * DAY).toISOString()
      await seed({
        help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, unconfirmedSince: since },
      })
      probe.script.set('help.acme.com', ['refused'])

      expect(await run()).toMatchObject({ confirmed: 1 })
      expect(await stored()).toEqual({
        help: {
          hostname: 'help.acme.com',
          verifiedAt: VERIFIED,
          reachWarning: { reason: 'unreachable', since: NOW.toISOString() },
        },
      })
      expect((await inUse()).signIn).toBe(VERIFIED)
    })

    it('clears the warning once a check reaches the hostname', async () => {
      await seed({
        help: {
          hostname: 'help.acme.com',
          verifiedAt: VERIFIED,
          reachWarning: { reason: 'unreachable', since: MISSED_YESTERDAY },
        },
      })

      expect(await run()).toMatchObject({ warned: 0, confirmed: 0 })
      expect(await stored()).toEqual({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
    })

    it('drops the warning for a first miss when the hostname then fails', async () => {
      await verifiedZone(null)
      await seed({
        help: {
          hostname: 'help.acme.com',
          verifiedAt: VERIFIED,
          reachWarning: { reason: 'unreachable', since: MISSED_YESTERDAY },
        },
      })
      probe.script.set('help.acme.com', ['refused'])

      expect(await run()).toMatchObject({ missed: 1 })
      expect(await stored()).toEqual({
        help: { hostname: 'help.acme.com', verifiedAt: VERIFIED, missedAt: NOW.toISOString() },
      })
    })
  })

  describe('the schedule gate', () => {
    // A shut gate writes no job row at all, so Cloud, where the control plane
    // decides when a domain is ready, gets no daily no-op per workspace.
    it('is shut on Cloud, even with a verified section hostname', async () => {
      await seed(
        { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
        { cloud: { enabled: true } as typeof settings.$inferInsert.cloud }
      )
      expect(await isSectionDomainsWatchDue()).toBe(false)
    })

    it('is shut before the server is set up', async () => {
      await testDb.delete(settings)
      expect(await isSectionDomainsWatchDue()).toBe(false)
    })

    it('is shut on a self-hosted server with no verified section hostname', async () => {
      await seed({ status: { hostname: 'status.acme.com', verifiedAt: null } })
      expect(await isSectionDomainsWatchDue()).toBe(false)
    })

    it('is open on a self-hosted server with a verified section hostname', async () => {
      await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
      expect(await isSectionDomainsWatchDue()).toBe(true)
    })

    it('is the gate the daily schedule runs behind', async () => {
      const def = JOB_DEFINITIONS.find((d) => d.name === 'section-domains-watch')
      await seed(
        { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
        { cloud: { enabled: true } as typeof settings.$inferInsert.cloud }
      )
      expect(await def?.cronEnabled?.()).toBe(false)
      await seed({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
      expect(await def?.cronEnabled?.()).toBe(true)
    })
  })

  it('does nothing on a server not yet set up, which has no settings row', async () => {
    await testDb.delete(settings)

    expect(await run()).toEqual({
      checked: 0,
      missed: 0,
      unconfirmed: 0,
      confirmed: 0,
      lapsed: 0,
      warned: 0,
    })
    expect(probe.asked).toEqual([])
  })

  it('leaves Cloud alone: there the control plane decides when a domain is ready', async () => {
    await seed(
      { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
      { cloud: { enabled: true } as typeof settings.$inferInsert.cloud }
    )
    probe.script.set('help.acme.com', ['unanswered'])

    expect(await run()).toEqual({
      checked: 0,
      missed: 0,
      unconfirmed: 0,
      confirmed: 0,
      lapsed: 0,
      warned: 0,
    })
    expect(probe.asked).toEqual([])
    expect(await stored()).toEqual({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
  })
})
