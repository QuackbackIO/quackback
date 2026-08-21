/**
 * Outcome constructors and the shared classification vocabulary.
 *
 * The one rule every probe follows: a cross-workspace attempt that did not obviously
 * succeed is NOT automatically a pass. It is a pass only when the matching
 * positive control proved the same attempt succeeds within its own workspace. A
 * suite without that rule scores an unreachable server, a revoked credential or
 * a typo'd URL as perfect isolation.
 */

import { MIN_MARKER_LENGTH } from '../tripwire'
import type { ControlOutcome, ProbeOutcome, ProbeResponse, WorkspaceMarkers } from '../types'

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

/** Direction helper for the `from → to` loops every cross-workspace probe uses. */
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

/**
 * Stop the probe early, WITHOUT bypassing the classification rule.
 *
 * This replaces a bare `error()` constructor, and the reason is the defect it
 * caused. Seven of the nine probes returned through an early `error(...)` that
 * hard-coded `verdict: 'ERROR'` while passing along the controls recorded so
 * far. So a probe could record a failed `invariant` — which the whole suite
 * documents as a LEAK, because a violated invariant IS a cross-workspace
 * capability — and then report `ERROR` with `LEAK: 0` because some later
 * positive control also failed. Demonstrated live on P03: with one storage
 * secret serving both slots it wrote the words "IDENTICAL — every read
 * capability minted for either workspace verifies against both, by construction"
 * into its own output and returned "could not run".
 *
 * `halt` records the stopping condition as a failed `visibility` control and
 * hands everything to `decide()`, whose precedence already says LEAK outranks
 * ERROR. A probe that stops early now still reports what it already saw.
 */
export function halt(args: {
  attempted: string
  /** Everything recorded before the probe had to stop. Never discarded. */
  controls: ControlOutcome[]
  /** The stopping condition, recorded as a failed `visibility` control. */
  stopped: { label: string; detail: string }
  /** The ERROR-branch reason: why this probe cannot conclude anything. */
  reason: string
  /** The LEAK-branch reason, used when a control already failed. */
  leakReason: string
  evidence?: Record<string, unknown>
}): ProbeOutcome {
  return decide({
    attempted: args.attempted,
    controls: [
      ...args.controls,
      control('visibility', args.stopped.label, false, args.stopped.detail),
    ],
    blindReason: args.reason,
    leakReason: args.leakReason,
    // Unreachable: the visibility control above always fails. Filled in anyway,
    // so that if a future edit ever removed it, an empty PASS reason would not
    // be the result.
    onPass: {
      observed: 'the probe stopped before it could compare the two workspaces',
      reason: 'no cross-workspace comparison was completed',
    },
    evidence: args.evidence,
  })
}

/**
 * The probe cannot run because a declared input was not supplied.
 *
 * Distinct from `halt`: BLOCKED means nothing was attempted, so there are no
 * observations to weigh. If a caller has already recorded a failing control,
 * that is an observation and it must be adjudicated rather than filed under
 * "not executed" — so it is routed through `decide()` like everything else.
 */
export function blocked(args: {
  attempted: string
  reason: string
  controls?: ControlOutcome[]
}): ProbeOutcome {
  const controls = args.controls ?? []
  if (controls.some((c) => !c.ok)) {
    return halt({
      attempted: args.attempted,
      controls,
      stopped: { label: 'the probe had every input it needs', detail: args.reason },
      reason: args.reason,
      leakReason:
        'a cross-workspace observation was already recorded before the probe ran out of inputs',
    })
  }
  return {
    verdict: 'BLOCKED',
    attempted: args.attempted,
    observed: 'not executed',
    reason: args.reason,
    controls,
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
 * cross-workspace capability, record it, print it, and still return PASS. One
 * shared rule means a control cannot be recorded but not counted — classifying
 * it IS the verdict logic.
 *
 * Precedence is deliberate. LEAK outranks ERROR: if a cross-workspace observation
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
  /** Replaces the generic ERROR reason when the probe can say something sharper. */
  blindReason?: string
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
        args.blindReason ??
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
 * Adjudicate a redirect the client refused to follow because it left the
 * workspace's own origin.
 *
 * Two outcomes, and the difference matters. If the refused target is the OTHER
 * workspace under test, this host handed the client across the workspace boundary,
 * which is a cross-workspace observation in its own right — `negative`. Any other
 * foreign origin (an identity provider, a CDN) leaves the probe unable to read
 * the surface it was going to judge — `visibility`, so ERROR rather than a
 * quiet pass.
 *
 * Returns `null` when both hosts served the surface themselves. Evaluated for
 * both hosts in one control, so it needs no `attemptId`: there is no direction
 * for it to be missing.
 */
export function crossOriginRedirectControl(
  surfaceLabel: string,
  reads: Array<{ slot: string; res: ProbeResponse; otherBaseUrl: string }>
): ControlOutcome | null {
  const offending = reads.filter((r) => r.res.crossOriginRedirect)
  if (offending.length === 0) return null

  const toOtherWorkspace = offending.filter(
    (r) => new URL(r.res.crossOriginRedirect!).origin === new URL(r.otherBaseUrl).origin
  )
  const describe = (r: (typeof offending)[number]) =>
    `${r.slot} redirected ${surfaceLabel} to ${r.res.crossOriginRedirect}`

  if (toOtherWorkspace.length > 0) {
    return control(
      'negative',
      `${surfaceLabel} is served by the host that was asked for it`,
      false,
      `REDIRECTED ACROSS THE WORKSPACE BOUNDARY — ${toOtherWorkspace.map(describe).join('; ')}. ` +
        'The redirect was not followed: a document fetched from the other workspace cannot be ' +
        'evidence about this one, and being sent there is itself the finding.',
      'both'
    )
  }

  return control(
    'visibility',
    `${surfaceLabel} is served by the host that was asked for it`,
    false,
    `${offending.map(describe).join('; ')} — the redirect was NOT followed, because a response ` +
      'from another origin cannot be judged as this workspace’s. This probe therefore never read ' +
      'the surface it was going to judge.'
  )
}

/**
 * Every marker of `owner` that appears verbatim in `text`.
 *
 * The length floor matches the tripwire's. Without it this matched any marker
 * at all, so a workspace named `Support` — a word bravo's own navigation
 * renders — was reported as a cross-workspace observation. Markers are additionally
 * filtered for genericity where they are built (`discoverMarkers`); this floor
 * is the backstop for anything that slips through.
 */
export function markersPresent(text: string, owner: WorkspaceMarkers): string[] {
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
 * it as one would hide a workspace-resolution bug behind an unhandled exception.
 * 5xx is reported as its own outcome so the operator sees it.
 */
export const REFUSAL_STATUSES = new Set([400, 401, 403, 404, 410, 422])

export function isRefusal(status: number): boolean {
  return REFUSAL_STATUSES.has(status)
}
