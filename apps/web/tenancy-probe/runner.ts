/**
 * The runner.
 *
 * Its whole job is to make sure that "no leak was found" and "no leak was
 * looked for" can never produce the same output. Preflight failure, an
 * unsatisfied capability, an exception inside a probe and a timeout are all
 * distinct, all reported per probe, and none of them are PASS.
 */

import { createTripwire } from './tripwire'
import { createTenantHttp } from './http'
import { runPreflight, type PreflightStep } from './preflight'
import { ALL_PROBES } from './probes'
import type {
  Capability,
  Probe,
  ProbeConfig,
  ProbeContext,
  ProbeLogger,
  ProbeReport,
  ProbeResult,
  TenantHandle,
  Verdict,
} from './types'

/** How an operator supplies each capability, quoted verbatim in BLOCKED reasons. */
const CAPABILITY_HINTS: Record<Capability, string> = {
  http: 'both --alpha and --bravo must be reachable',
  admin: 'an admin sign-in must succeed on both tenants (--admin-email / --admin-password)',
  db: 'pass --alpha-db and --bravo-db',
  'storage-secret': 'pass --alpha-storage-secret and --bravo-storage-secret',
  'api-key': 'pass --alpha-api-key and --bravo-api-key',
  'widget-secret':
    'pass --alpha-widget-secret and --bravo-widget-secret, or supply --alpha-db/--bravo-db',
}

export interface RunOutput {
  report: ProbeReport
  preflightSteps: PreflightStep[]
  /** Probes excluded by --only. Present so a filtered run can never read as a full one. */
  filteredOut: string[]
}

function emptyCounts(): Record<Verdict, number> {
  return { PASS: 0, LEAK: 0, ERROR: 0, BLOCKED: 0 }
}

function truncate(value: unknown, max = 2000): string {
  const text =
    value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ''}` : String(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export async function runSuite(
  config: ProbeConfig,
  log: ProbeLogger,
  probes: Probe[] = ALL_PROBES
): Promise<RunOutput> {
  const startedAt = new Date()

  const emptyMarkers = (slot: 'alpha' | 'bravo') => ({ slot, canary: '', ids: {} }) as const
  const tripwire = createTripwire(emptyMarkers('alpha'), emptyMarkers('bravo'))

  const preflight = await runPreflight(config, tripwire, log)
  const { alpha, bravo } = preflight

  // The vocabulary only exists after the fixture is known; install it now so
  // every probe request from here on is scanned.
  tripwire.setMarkers(alpha.markers, bravo.markers)

  const selected = config.only
    ? probes.filter((p) => config.only!.includes(p.id.toUpperCase()))
    : probes
  const filteredOut = probes.filter((p) => !selected.includes(p)).map((p) => p.id)

  const ctx: ProbeContext = {
    config,
    alpha,
    bravo,
    tripwire,
    capabilities: preflight.capabilities,
    log,
    newClient(handle: TenantHandle) {
      return createTenantHttp({
        slot: handle.slot,
        baseUrl: handle.baseUrl,
        tripwire,
        defaultTimeoutMs: config.requestTimeoutMs,
      })
    },
  }

  const results: ProbeResult[] = []

  for (const probe of selected) {
    const hitsBefore = tripwire.hitCount()
    const probeStart = Date.now()

    const base = {
      id: probe.id,
      name: probe.name,
      family: probe.family,
      proves: probe.proves,
      requires: probe.requires,
      poolingCaveat: probe.poolingCaveat,
    }

    // --- preflight failure propagates as ERROR, never as a skip -------------
    if (!preflight.ok) {
      results.push({
        ...base,
        verdict: 'ERROR',
        attempted: 'not attempted',
        observed: 'preflight did not complete',
        reason: `preflight failed: ${preflight.failureReason}`,
        controls: [],
        durationMs: 0,
        tripwireHits: [],
      })
      continue
    }

    // --- unmet capabilities are BLOCKED, with the exact remedy -------------
    const missing = probe.requires.filter((c) => !preflight.capabilities.has(c))
    if (missing.length > 0) {
      results.push({
        ...base,
        verdict: 'BLOCKED',
        attempted: 'not attempted',
        observed: 'required inputs unavailable',
        reason:
          `missing capability: ${missing.join(', ')}. ` +
          missing.map((c) => `${c}: ${CAPABILITY_HINTS[c]}`).join('; '),
        controls: [],
        durationMs: 0,
        tripwireHits: [],
      })
      continue
    }

    log.info({ probe: probe.id }, 'running probe')
    try {
      const outcome = await probe.run(ctx)
      const hits = tripwire.hitsSince(hitsBefore)
      // A tripwire hit overrides a self-reported PASS. A probe that concluded
      // "refused" while a foreign marker sat in a response body it did not
      // inspect is exactly the blind spot the tripwire exists to cover.
      const verdict: Verdict =
        hits.length > 0 && outcome.verdict === 'PASS' ? 'LEAK' : outcome.verdict
      results.push({
        ...base,
        ...outcome,
        verdict,
        reason:
          verdict === 'LEAK' && outcome.verdict === 'PASS'
            ? `the probe's own checks passed, but the response tripwire caught ${hits.length} foreign marker(s) in responses this probe made: ${hits.map((h) => `${h.markerOwner}.${h.markerName} served by ${h.servedBy} at ${h.url}`).join('; ')}`
            : outcome.reason,
        durationMs: Date.now() - probeStart,
        tripwireHits: hits,
      })
    } catch (err) {
      results.push({
        ...base,
        verdict: 'ERROR',
        attempted: 'probe threw before reaching a verdict',
        observed: truncate(err),
        reason:
          'the probe raised an exception, so no conclusion about isolation is available. An error is ' +
          'never a pass.',
        controls: [],
        durationMs: Date.now() - probeStart,
        tripwireHits: tripwire.hitsSince(hitsBefore),
      })
    }
  }

  const counts = emptyCounts()
  for (const r of results) counts[r.verdict]++

  const finishedAt = new Date()
  const allPass =
    counts.LEAK === 0 && counts.ERROR === 0 && (counts.BLOCKED === 0 || config.allowBlocked)

  const report: ProbeReport = {
    suite: 'quackback-tenant-isolation',
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    targets: { alpha: config.alphaUrl, bravo: config.bravoUrl },
    capabilities: [...preflight.capabilities],
    missingCapabilities: preflight.missing,
    markers: { alpha: alpha.markers, bravo: bravo.markers },
    verdict: allPass ? 'PASS' : 'FAIL',
    counts,
    tripwireHits: tripwire.hits(),
    probes: results,
  }

  await Promise.allSettled([alpha.db?.close(), bravo.db?.close()])

  return { report, preflightSteps: preflight.steps, filteredOut }
}

/**
 * Exit codes are distinct so CI can tell a cross-tenant observation from a
 * harness that could not run.
 *   0 — every probe passed
 *   1 — one or more probes could not execute (ERROR/BLOCKED), nothing leaked
 *   2 — a cross-tenant observation was made
 */
export function exitCodeFor(report: ProbeReport): 0 | 1 | 2 {
  if (report.counts.LEAK > 0) return 2
  if (report.verdict === 'FAIL') return 1
  return 0
}
