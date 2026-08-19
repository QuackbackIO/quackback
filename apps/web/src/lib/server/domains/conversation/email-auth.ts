/**
 * Inbound email authentication gate (support platform §4.8). Cold inbound email
 * can spoof its From, so before an unknown sender is trusted we read the
 * Authentication-Results header the receiving MTA stamped and turn it into a
 * trust verdict. We do NOT verify SPF/DKIM ourselves (no DNS lookups, no
 * signature math) — a missing or unparseable header is simply untrusted.
 *
 * The verdict is consumed split-by-action by the cold-inbound path:
 *   - pass       → DMARC-aligned; may ATTACH to an identified principal/company.
 *   - unverified → create a standalone contact with an "unverified sender" badge;
 *                  never auto-attach to an existing identity.
 *   - reject     → hard DMARC reject (fail under a p=reject policy); drop outright.
 *
 * This is a pure function so it unit-tests exhaustively against real header shapes.
 */

export type InboundAuthVerdict = 'pass' | 'unverified' | 'reject'
export type DmarcResult = 'pass' | 'fail' | 'none' | 'unknown'
export type DmarcPolicy = 'reject' | 'quarantine' | 'none'

export interface InboundAuthResult {
  verdict: InboundAuthVerdict
  dmarc: DmarcResult
  /** The published DMARC policy the MTA noted (p=…), when present. */
  policy: DmarcPolicy | null
  /** Short human-readable reason, for the agent-facing sender badge / audit. */
  reason: string
}

/**
 * Evaluate an inbound message's Authentication-Results header into a trust
 * verdict. `null` (header absent) is untrusted, not an error.
 */
export function evaluateInboundAuth(authResultsHeader: string | null): InboundAuthResult {
  if (!authResultsHeader || !authResultsHeader.trim()) {
    return {
      verdict: 'unverified',
      dmarc: 'unknown',
      policy: null,
      reason: 'no Authentication-Results header',
    }
  }

  const header = authResultsHeader.toLowerCase()
  const dmarcMatch = /\bdmarc=(pass|fail|none|neutral|temperror|permerror)\b/.exec(header)
  // A published policy the MTA echoed in the dmarc comment, e.g. dmarc=fail (p=reject …).
  const policyMatch = /\bdmarc=\w+\s*\([^)]*\bp=(reject|quarantine|none)\b/.exec(header)
  const policy = (policyMatch?.[1] as DmarcPolicy | undefined) ?? null

  const raw = dmarcMatch?.[1]
  const dmarc: DmarcResult =
    raw === 'pass' ? 'pass' : raw === 'fail' ? 'fail' : raw === 'none' ? 'none' : 'unknown'

  if (dmarc === 'pass') {
    // DMARC pass already implies SPF-or-DKIM alignment with the From domain.
    return { verdict: 'pass', dmarc, policy, reason: 'DMARC pass (aligned)' }
  }
  if (dmarc === 'fail' && policy === 'reject') {
    return { verdict: 'reject', dmarc, policy, reason: 'DMARC fail under p=reject' }
  }
  // fail under quarantine/none, none, neutral, temp/permerror, or an
  // unparseable result: untrusted but not dropped — created with a badge.
  return {
    verdict: 'unverified',
    dmarc,
    policy,
    reason:
      dmarc === 'fail'
        ? `DMARC fail (p=${policy ?? 'unspecified'})`
        : dmarc === 'none'
          ? 'no DMARC alignment'
          : 'DMARC result absent or inconclusive',
  }
}
