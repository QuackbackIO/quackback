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
  probes = ALL_PROBES
): Promise<{ report: ProbeReport; exit: number }> {
  const fleet = new FakeFleet(leaks)
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
