/**
 * Outcome constructors and the shared classification vocabulary.
 *
 * The one rule every probe follows: a cross-tenant attempt that did not obviously
 * succeed is NOT automatically a pass. It is a pass only when the matching
 * positive control proved the same attempt succeeds within its own tenant. A
 * suite without that rule scores an unreachable server, a revoked credential or
 * a typo'd URL as perfect isolation.
 */

import type { ControlOutcome, ProbeOutcome, ProbeResponse, TenantMarkers } from '../types'

export function control(
  kind: ControlOutcome['kind'],
  label: string,
  ok: boolean,
  detail: string
): ControlOutcome {
  return { kind, label, ok, detail }
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

/** Every marker of `owner` that appears verbatim in `text`. */
export function markersPresent(text: string, owner: TenantMarkers): string[] {
  const found: string[] = []
  if (owner.canary && text.includes(owner.canary)) found.push(`canary=${owner.canary}`)
  for (const [name, value] of Object.entries(owner.ids)) {
    if (value && text.includes(value)) found.push(`${name}=${value}`)
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
