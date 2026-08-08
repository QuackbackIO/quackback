/**
 * Outcome constructors and the shared classification vocabulary.
 *
 * The one rule every probe follows: a cross-tenant attempt that did not obviously
 * succeed is NOT automatically a pass. It is a pass only when the matching
 * positive control proved the same attempt succeeds within its own tenant. A
 * suite without that rule scores an unreachable server, a revoked credential or
 * a typo'd URL as perfect isolation.
 */

import { MIN_MARKER_LENGTH } from '../tripwire'
import type { ControlOutcome, ProbeOutcome, ProbeResponse, TenantMarkers } from '../types'

export function control(
  kind: ControlOutcome['kind'],
  label: string,
  ok: boolean,
  detail: string,
  direction?: ControlOutcome['direction'],
  attemptId?: string
): ControlOutcome {
  return {
    kind,
    label,
    ok,
    detail,
    ...(direction ? { direction } : {}),
    ...(attemptId ? { attemptId } : {}),
  }
}

/** Direction helper for the `from → to` loops every cross-tenant probe uses. */
export function dirFrom(fromSlot: 'alpha' | 'bravo'): 'a-to-b' | 'b-to-a' {
  return fromSlot === 'alpha' ? 'a-to-b' : 'b-to-a'
}

export function pass(args: {
  attempted: string
  observed: string
  reason: string
  controls: ControlOutcome[]
  evidence?: Record<string, unknown>
}): ProbeOutcome {
  return { verdict: 'PASS', ...args }
}

export function leak(args: {
  attempted: string
  observed: string
  reason: string
  controls: ControlOutcome[]
  evidence?: Record<string, unknown>
}): ProbeOutcome {
  return { verdict: 'LEAK', ...args }
}

export function error(args: {
  attempted: string
  observed: string
  reason: string
  controls?: ControlOutcome[]
  evidence?: Record<string, unknown>
}): ProbeOutcome {
  return { verdict: 'ERROR', controls: [], ...args }
}

export function blocked(args: {
  attempted: string
  reason: string
  controls?: ControlOutcome[]
}): ProbeOutcome {
  return {
    verdict: 'BLOCKED',
    attempted: args.attempted,
    observed: 'not executed',
    reason: args.reason,
    controls: args.controls ?? [],
  }
}

/**
 * Map a probe's controls to a verdict. Every probe uses this; none implements
 * its own filter.
 *
 * The reason it is centralized: an earlier version of this suite decided each
 * probe's verdict with a local `controls.filter(c => c.kind === 'negative' && !c.ok)`.
 * That silently dropped failed `invariant` controls from the decision, so a
 * probe could observe the exact configuration fact that constitutes a
 * cross-tenant capability, record it, print it, and still return PASS. One
 * shared rule means a control cannot be recorded but not counted — classifying
 * it IS the verdict logic.
 *
 * Precedence is deliberate. LEAK outranks ERROR: if a cross-tenant observation
 * was actually made, that is evidence regardless of what else went wrong, and
 * downgrading it to "could not run" would lose the finding.
 */
export function decide(args: {
  attempted: string
  controls: ControlOutcome[]
  /** Used when every control holds. */
  onPass: { observed: string; reason: string }
  /** Prefix for the LEAK reason; the failing controls are appended. */
  leakReason: string
  evidence?: Record<string, unknown>
}): ProbeOutcome {
  const failed = args.controls.filter((c) => !c.ok)
  const leaking = failed.filter((c) => c.kind === 'negative' || c.kind === 'invariant')
  const blind = failed.filter((c) => c.kind === 'positive' || c.kind === 'visibility')

  if (leaking.length > 0) {
    return {
      verdict: 'LEAK',
      attempted: args.attempted,
      observed: leaking.map((c) => `${c.label}: ${c.detail}`).join(' | '),
      reason:
        args.leakReason +
        (blind.length > 0
          ? ` (note: ${blind.length} control(s) also failed to establish visibility, so the leak may be wider than reported)`
          : ''),
      controls: args.controls,
      evidence: args.evidence,
    }
  }

  if (blind.length > 0) {
    return {
      verdict: 'ERROR',
      attempted: args.attempted,
      observed: blind.map((c) => `${c.label}: ${c.detail}`).join(' | '),
      reason:
        'the probe could not establish that it was capable of seeing a leak, so its silence is not ' +
        'evidence of isolation. Fix the failing control(s) above and re-run.',
      controls: args.controls,
      evidence: args.evidence,
    }
  }

  return {
    verdict: 'PASS',
    attempted: args.attempted,
    observed: args.onPass.observed,
    reason: args.onPass.reason,
    controls: args.controls,
    evidence: args.evidence,
  }
}

/**
 * A probe fails closed only if the positive control held. This wraps the common
 * shape: "the mechanism works inside its own tenant, and refused across."
 */
export function requirePositiveControl(
  positive: ControlOutcome,
  attempted: string
): ProbeOutcome | null {
  if (positive.ok) return null
  return error({
    attempted,
    observed: positive.detail,
    reason:
      `the positive control failed, so a refusal from the other tenant proves nothing — ` +
      `the credential or endpoint under test does not work even within its own tenant. ` +
      `Fix this before reading any verdict from this probe.`,
    controls: [positive],
  })
}

/**
 * Every marker of `owner` that appears verbatim in `text`.
 *
 * The length floor matches the tripwire's. Without it this matched any marker
 * at all, so a workspace named `Support` — a word bravo's own navigation
 * renders — was reported as a cross-tenant observation. Markers are additionally
 * filtered for genericity where they are built (`discoverMarkers`); this floor
 * is the backstop for anything that slips through.
 */
export function markersPresent(text: string, owner: TenantMarkers): string[] {
  const found: string[] = []
  if (owner.canary.length >= MIN_MARKER_LENGTH && text.includes(owner.canary)) {
    found.push(`canary=${owner.canary}`)
  }
  for (const [name, value] of Object.entries(owner.ids)) {
    if (value && value.length >= MIN_MARKER_LENGTH && text.includes(value)) {
      found.push(`${name}=${value}`)
    }
  }
  return found
}

/** Compact response description for the `observed` field. */
export function describeResponse(res: ProbeResponse, maxBody = 200): string {
  const body = res.text.replace(/\s+/g, ' ').trim().slice(0, maxBody)
  return `HTTP ${res.status}${body ? ` — ${body}` : ''}`
}

/**
 * Statuses that constitute a loud, distinguishable refusal.
 *
 * 5xx is deliberately excluded: a crash is not a designed refusal, and treating
 * it as one would hide a tenant-resolution bug behind an unhandled exception.
 * 5xx is reported as its own outcome so the operator sees it.
 */
export const REFUSAL_STATUSES = new Set([400, 401, 403, 404, 410, 422])

export function isRefusal(status: number): boolean {
  return REFUSAL_STATUSES.has(status)
}
