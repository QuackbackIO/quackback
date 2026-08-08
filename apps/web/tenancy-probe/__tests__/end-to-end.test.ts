/**
 * End-to-end validation: the real `runSuite → report → exitCodeFor` path.
 *
 * These exist because probe-level tests were not enough. Three defects survived
 * an earlier round of sensitivity testing — P02 could never execute at all, P07's
 * blind guard was satisfied by fixture data, and P06 reported PASS on the leak it
 * was written to catch — and the reason they survived is that the tests
 * exercised individual `probe.run()` calls, and two of the probes were never
 * imported by a test at all.
 *
 * So every case here drives the whole pipeline: preflight, capability gating,
 * verdict assembly, the tripwire, the report, and the process exit code.
 */

import { describe, expect, it } from 'vitest'
import { runSuite, exitCodeFor } from '../runner'
import { ALL_PROBES } from '../probes'
import { p02MagicLinkOtp } from '../probes/p02-magic-link-otp'
import { p06SettingsCache } from '../probes/p06-settings-cache'
import { p07BackgroundJob } from '../probes/p07-background-job'
import {
  FakeFleet,
  baseConfig,
  createFakeDb,
  fakeSettings,
  silentLogger,
  type FleetIdentity,
  type FleetLeaks,
} from './fake-fleet'
import { toUuid } from '@quackback/ids'
import type { ProbeConfig, ProbeReport, TenantSlot } from '../types'

function configFor(fleet: FakeFleet, over: Partial<ProbeConfig> = {}): ProbeConfig {
  return baseConfig(fleet, {
    alphaDatabaseUrl: 'postgres://alpha/db',
    bravoDatabaseUrl: 'postgres://bravo/db',
    ...over,
  })
}

async function run(
  leaks: FleetLeaks,
  over: Partial<ProbeConfig> = {},
  probes = ALL_PROBES,
  identity: Partial<Record<TenantSlot, FleetIdentity>> = {}
): Promise<{ report: ProbeReport; exit: number }> {
  const fleet = new FakeFleet(leaks, identity)
  const config = configFor(fleet, over)
  const { report } = await runSuite(config, silentLogger, probes, {
    fetchImpl: fleet.fetch,
    createDb: (slot: TenantSlot) => {
      const tenant = slot === 'alpha' ? fleet.alpha : fleet.bravo
      return createFakeDb(slot, {
        settings: fakeSettings(tenant),
        assistantPrincipalUuid: leaks.sharedAssistantPrincipal
          ? fleet.alpha.assistantPrincipalUuid
          : tenant.assistantPrincipalUuid,
        liveMagicLinkToken: () => fleet.liveMagicLinks.get(slot),
        liveOtpCode: () => fleet.liveOtps.get(slot),
        rows: {
          posts: [{ id: toUuid(tenant.postId), content: `canary ${tenant.canary}` }],
          boards: [{ description: `canary ${tenant.canary}` }],
          ...(leaks.noBackgroundProcessing
            ? {}
            : { post_activity: [{ post_id: toUuid(tenant.postId) }] }),
        },
      })
    },
  })
  return { report, exit: exitCodeFor(report) }
}

function probe(report: ProbeReport, id: string) {
  const found = report.probes.find((p) => p.id === id)
  if (!found) throw new Error(`probe ${id} missing from report`)
  return found
}

describe('a clean fleet', () => {
  it('passes every probe and exits 0', async () => {
    const { report, exit } = await run({})
    const notPassing = report.probes.filter((p) => p.verdict !== 'PASS')
    expect(notPassing.map((p) => `${p.id}:${p.verdict}:${p.reason}`)).toEqual([])
    expect(report.verdict).toBe('PASS')
    expect(report.counts.LEAK).toBe(0)
    expect(exit).toBe(0)
  })

  it('is not thrown by a per-request nonce in the portal document', async () => {
    // Precision bar: a byte that legitimately varies between requests must
    // never on its own be reported as a cross-tenant leak.
    const { report, exit } = await run({ perRequestNonce: true })
    expect(probe(report, 'P06').verdict).toBe('PASS')
    expect(report.counts.LEAK).toBe(0)
    expect(exit).toBe(0)
  })

  it('never writes a credential into the report', async () => {
    const { report } = await run({})
    const fleet = new FakeFleet({})
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(fleet.alpha.widgetSecret)
    expect(serialized).not.toContain(fleet.bravo.widgetSecret)
    expect(serialized).not.toContain(fleet.alpha.apiKey)
    expect(Object.keys(report.markers.alpha.ids)).not.toContain('widgetSecret')
  })
})

describe('planted settings-cache leak (P06)', () => {
  // The shape that defeated the previous implementation: bravo serves alpha's
  // cached settings blob, and the leaking surfaces carry NO workspace id and NO
  // slug — only the theme colour and the workspace name.
  const leak: FleetLeaks = { sharedSettingsCache: true }

  it('is caught, named, and exits 2', async () => {
    const { report, exit } = await run(leak)
    const p06 = probe(report, 'P06')
    expect(p06.verdict).toBe('LEAK')
    expect(p06.reason).toContain('cache keyed without a tenant segment')
    expect(report.verdict).toBe('FAIL')
    expect(exit).toBe(2)
  })

  it('names the foreign identity it actually observed', async () => {
    const { report } = await run(leak)
    const observed = probe(report, 'P06').observed
    expect(observed).toContain('FOREIGN IDENTITY SERVED')
    expect(observed).toContain('Alpha Workspace')
  })

  it('is caught even when only the theme-bearing surface is checked', async () => {
    // `/api/widget/config.json` carries no identifier at all — its only tenant
    // signal is the branding colour, which is why the identity vocabulary is
    // derived from stored settings rather than assumed.
    const { report } = await run(leak, {}, [p06SettingsCache])
    const evidence = probe(report, 'P06').evidence as Record<string, { foreignOnBravo: string[] }>
    expect(evidence['surface:/api/widget/config.json'].foreignOnBravo).toContain('#aa1122')
  })

  it('produces a report that differs from the clean run', async () => {
    // The regression that made this defect invisible: leaking and clean runs
    // emitted byte-identical output.
    const clean = await run({})
    const leaking = await run(leak)
    expect(JSON.stringify(leaking.report.probes.map((p) => p.verdict))).not.toBe(
      JSON.stringify(clean.report.probes.map((p) => p.verdict))
    )
  })
})

describe('P02 magic-link and OTP', () => {
  it('executes rather than erroring on a healthy fleet', async () => {
    // The defect this pins: `omitCookies` once suppressed cookie ABSORPTION as
    // well as sending, so a successful redemption was never observed and this
    // probe could never reach any verdict but ERROR.
    const { report } = await run({}, {}, [p02MagicLinkOtp])
    const p02 = probe(report, 'P02')
    expect(p02.verdict).toBe('PASS')
    expect(p02.controls.filter((c) => c.kind === 'positive').every((c) => c.ok)).toBe(true)
  })

  it('catches a shared credential store and exits 2', async () => {
    const { report, exit } = await run({ sharedSessionStore: true }, {}, [p02MagicLinkOtp])
    expect(probe(report, 'P02').verdict).toBe('LEAK')
    expect(exit).toBe(2)
  })
})

describe('P07 background job', () => {
  it('reports ERROR, not PASS, when there is no background processing to observe', async () => {
    // The fixture writes the canary into `boards.description`, which once
    // satisfied the "derived rows exist" guard all by itself.
    const { report, exit } = await run({ noBackgroundProcessing: true }, {}, [p07BackgroundJob])
    const p07 = probe(report, 'P07')
    expect(p07.verdict).toBe('ERROR')
    expect(p07.reason).toContain('blind')
    expect(exit).toBe(1)
  })

  it('passes when derived rows exist only in the driving tenant', async () => {
    const { report } = await run({}, {}, [p07BackgroundJob])
    expect(probe(report, 'P07').verdict).toBe('PASS')
  })
})

describe('P09 assistant principal', () => {
  it('catches one principal id serving both tenants and exits 2', async () => {
    const { report, exit } = await run({ sharedAssistantPrincipal: true })
    expect(probe(report, 'P09').verdict).toBe('LEAK')
    expect(exit).toBe(2)
  })
})

describe('run integrity', () => {
  it('records a filtered run in the machine-readable report, not only the summary', async () => {
    const { report } = await run({}, { only: ['P05'] })
    expect(report.partial).toBe(true)
    expect(report.filteredOut.length).toBeGreaterThan(0)
    expect(report.filteredOut).not.toContain('P05')
    expect(report.probes).toHaveLength(1)
  })

  it('marks a full run as not partial', async () => {
    const { report } = await run({})
    expect(report.partial).toBe(false)
    expect(report.filteredOut).toEqual([])
  })

  it('fails every probe closed when the fleet is unreachable', async () => {
    const { report, exit } = await run({ offline: true })
    expect(report.probes.every((p) => p.verdict === 'ERROR')).toBe(true)
    expect(report.counts.PASS).toBe(0)
    expect(exit).toBe(1)
  })

  it('blocks the database probes rather than passing them when no database URL is given', async () => {
    const fleet = new FakeFleet({})
    const { report } = await runSuite(baseConfig(fleet), silentLogger, ALL_PROBES, {
      fetchImpl: fleet.fetch,
    })
    for (const id of ['P02', 'P06', 'P07', 'P09']) {
      expect(probe(report, id).verdict, `${id} should be BLOCKED without a database`).toBe(
        'BLOCKED'
      )
    }
    expect(report.counts.PASS).toBeGreaterThan(0)
    expect(exitCodeFor(report)).toBe(1)
  })
})

/**
 * Precision: correctly isolated fleets built specifically to trip the identity
 * vocabulary.
 *
 * Every one of these exited 2 before the vocabulary was constrained. Recall and
 * precision have to hold at the same time — a suite that finds every leak by
 * accusing every fleet is no more useful than one that finds none.
 */
describe('correct fleets that must NOT be accused', () => {
  it('tolerates a workspace theme containing an ordinary white', async () => {
    // Alpha's custom CSS carries #ffffff; bravo has no custom CSS at all, so
    // #ffffff is exclusive to alpha's settings row — yet every stylesheet in
    // existence contains it, including the chrome bravo renders itself.
    const { report, exit } = await run({}, {}, ALL_PROBES, {
      alpha: { customCss: ':root { --primary: #a11111; --card: #ffffff; }' },
      bravo: { customCss: ':root { --primary: #22bb44; }' },
    })
    expect(probe(report, 'P06').verdict).toBe('PASS')
    expect(report.counts.LEAK).toBe(0)
    expect(exit).toBe(0)
  })

  it('tolerates a workspace named Support, which the other tenant renders in its nav', async () => {
    const { report, exit } = await run({}, {}, ALL_PROBES, {
      alpha: { name: 'Support' },
      bravo: { name: 'Helpdesk Central' },
    })
    expect(report.counts.LEAK).toBe(0)
    expect(report.tripwireHits).toEqual([])
    expect(exit).toBe(0)
  })

  it('tolerates a workspace named after the board this suite creates in BOTH tenants', async () => {
    // `FIXTURE.boardName` is written into alpha and bravo by the harness, so
    // finding it on the "wrong" host is the suite observing its own handiwork.
    const { report, exit } = await run({}, {}, ALL_PROBES, {
      alpha: { name: 'Feature Requests' },
      bravo: { name: 'Product Ideas' },
    })
    expect(report.counts.LEAK).toBe(0)
    expect(exit).toBe(0)
  })

  it('still catches a real leak on a fleet whose names are generic', async () => {
    // The precision fixes must not have been bought by loosening detection: a
    // genuine cache serve is caught even when neither name is distinctive,
    // because the leaking host presents no identity of its own.
    const { report, exit } = await run({ sharedSettingsCache: true }, {}, ALL_PROBES, {
      alpha: { name: 'Support', theme: '#a11111' },
      bravo: { name: 'Helpdesk Central', theme: '#22bb44' },
    })
    expect(probe(report, 'P06').verdict).toBe('LEAK')
    expect(exit).toBe(2)
  })
})

describe('partial identity leak on generically-named tenants (round 4)', () => {
  // The plant that stayed green in round 3: TENANT_SETTINGS collides while the
  // branding cache does not, so bravo renders alpha's NAME while painting its
  // OWN colour. Both names are built entirely from common product words, so the
  // genericity filter swallowed the leaked value, preflight dropped it from the
  // tripwire vocabulary, and own-identity corroboration masked what was left.
  // The planted identity token fails this shape by construction: the leaking
  // surface carries the foreign planted token while missing the host's own.
  const genericNames: Partial<Record<TenantSlot, FleetIdentity>> = {
    alpha: { name: 'Help Center' },
    bravo: { name: 'Support Portal' },
  }

  it('is caught, named, and exits 2', async () => {
    const { report, exit } = await run({ partialIdentityLeak: true }, {}, ALL_PROBES, genericNames)
    const p06 = probe(report, 'P06')
    expect(p06.verdict).toBe('LEAK')
    expect(p06.observed).toContain("BRAVO SERVED ALPHA'S PLANTED TOKEN")
    expect(report.verdict).toBe('FAIL')
    expect(exit).toBe(2)
  })

  it('fires the tripwire on the planted marker even though the leaked name is generic', async () => {
    // The generic name was dropped from the tripwire vocabulary; the planted
    // token is installed unconditionally, so the backstop sees this leak too.
    const { report } = await run({ partialIdentityLeak: true }, {}, ALL_PROBES, genericNames)
    expect(
      report.tripwireHits.some(
        (h) =>
          h.markerName === 'identityToken' && h.markerOwner === 'alpha' && h.servedBy === 'bravo'
      )
    ).toBe(true)
  })

  it('keeps the same generically-named fleet green when nothing leaks', async () => {
    const { report, exit } = await run({}, {}, ALL_PROBES, genericNames)
    expect(probe(report, 'P06').verdict).toBe('PASS')
    expect(report.counts.LEAK).toBe(0)
    expect(report.tripwireHits).toEqual([])
    expect(exit).toBe(0)
  })

  it('reports ERROR, not PASS, when the planted token is not observable on any surface', async () => {
    // The visibility gate counts observed responses, not stored values: until
    // each host is caught serving its own planted token, a PASS would certify
    // distinguishability the suite cannot see — the exact failure (the
    // workspace TypeID plus the one unleaked colour counted as "exclusive
    // tokens") that made the round-3 gate worthless.
    const { report, exit } = await run({ omitPlantedToken: true })
    const p06 = probe(report, 'P06')
    expect(p06.verdict).toBe('ERROR')
    expect(p06.observed).toContain('planted identity token')
    expect(report.counts.LEAK).toBe(0)
    expect(exit).toBe(1)
  })
})

describe('shared credential stash, both polarities', () => {
  // Which tenant's value survives an email-keyed stash collision is a coin
  // flip. An earlier P02 attempted only alpha's-OTP-on-bravo, so a
  // last-writer-wins stash — where bravo's value survives — produced a fully
  // green run. Detection must not depend on mint ordering.
  for (const policy of ['first-writer-wins', 'last-writer-wins'] as const) {
    it(`catches a shared stash under ${policy} and exits 2`, async () => {
      const { report, exit } = await run({ sharedStash: policy }, {}, [p02MagicLinkOtp])
      const p02 = probe(report, 'P02')
      expect(p02.verdict).toBe('LEAK')
      expect(exit).toBe(2)
    })
  }

  it('tests both directions for the OTP, not just one', async () => {
    const { report } = await run({}, {}, [p02MagicLinkOtp])
    const labels = probe(report, 'P02')
      .controls.filter((c) => c.kind === 'negative')
      .map((c) => c.label)
    expect(labels).toContain("alpha's sign-in OTP → bravo /api/auth/sign-in/email-otp")
    expect(labels).toContain("bravo's sign-in OTP → alpha /api/auth/sign-in/email-otp")
  })
})

describe('directional symmetry', () => {
  it('declares a direction on every negative control', async () => {
    const { report } = await run({})
    for (const p of report.probes) {
      for (const c of p.controls.filter((x) => x.kind === 'negative')) {
        expect(
          c.direction,
          `${p.id} control "${c.label}" has no declared direction — pass one to control()`
        ).toBeDefined()
      }
    }
  })

  it('makes every cross-tenant attempt in both directions', async () => {
    // The property the OTP gap violated: P02 attempted only
    // alpha's-OTP-on-bravo, and because an email-keyed stash is
    // last-writer-wins, the surviving credential was bravo's — so the only
    // redemption that could have succeeded was the one never attempted.
    // Asserted structurally so a new one-directional check cannot be added
    // without this failing.
    const { report } = await run({})
    for (const p of report.probes) {
      const negatives = p.controls.filter((c) => c.kind === 'negative')
      if (negatives.length === 0) continue
      const covered = new Set(
        negatives.flatMap((c) => (c.direction === 'both' ? ['a-to-b', 'b-to-a'] : [c.direction]))
      )
      expect(
        covered.has('a-to-b') && covered.has('b-to-a'),
        `${p.id} (${p.name}) covers only ${[...covered].join(', ')}: ` +
          negatives.map((c) => `${c.label} [${c.direction}]`).join(' | ')
      ).toBe(true)
    }
  })

  it('pairs every single-direction attempt with its reverse, per attempt', async () => {
    // The aggregate check above is necessary but not sufficient: a fresh
    // one-directional control landing in an already-symmetric probe leaves the
    // union covering both directions, and the asymmetric attempt sails through.
    // So every `a-to-b` / `b-to-a` negative control declares which attempt it is
    // one direction of (`attemptId`), and each attempt must cover BOTH
    // directions between its controls.
    const { report } = await run({})
    for (const p of report.probes) {
      const singles = p.controls.filter(
        (c) => c.kind === 'negative' && (c.direction === 'a-to-b' || c.direction === 'b-to-a')
      )
      const byAttempt = new Map<string, Set<string>>()
      for (const c of singles) {
        expect(
          c.attemptId,
          `${p.id} control "${c.label}" [${c.direction}] declares no attemptId — a one-directional ` +
            'attempt without its reverse is exactly the defect the direction guard exists to ' +
            'catch; pass one to control()'
        ).toBeDefined()
        const directions = byAttempt.get(c.attemptId!) ?? new Set<string>()
        directions.add(c.direction!)
        byAttempt.set(c.attemptId!, directions)
      }
      for (const [attemptId, directions] of byAttempt) {
        expect(
          directions.has('a-to-b') && directions.has('b-to-a'),
          `${p.id} (${p.name}) attempt "${attemptId}" covers only ${[...directions].join(', ')} — ` +
            "detection would depend on which tenant's value happens to survive"
        ).toBe(true)
      }
    }
  })
})

describe('--allow-blocked', () => {
  it('never reports verdict PASS while probes did not run', async () => {
    const fleet = new FakeFleet({})
    const { report } = await runSuite(
      baseConfig(fleet, { allowBlocked: true }),
      silentLogger,
      ALL_PROBES,
      { fetchImpl: fleet.fetch }
    )
    expect(report.counts.BLOCKED).toBeGreaterThan(0)
    // The flag softens the exit code only. A CI check keyed on `verdict` must
    // not read green while four of nine probes never executed.
    expect(report.verdict).toBe('FAIL')
    expect(report.exitTolerates).toContain('BLOCKED')
    expect(exitCodeFor(report)).toBe(0)
  })

  it('still fails the exit code on a leak even with --allow-blocked', async () => {
    const fleet = new FakeFleet({ sharedApiKeys: true })
    const { report } = await runSuite(
      baseConfig(fleet, { allowBlocked: true }),
      silentLogger,
      ALL_PROBES,
      { fetchImpl: fleet.fetch }
    )
    expect(exitCodeFor(report)).toBe(2)
  })
})
