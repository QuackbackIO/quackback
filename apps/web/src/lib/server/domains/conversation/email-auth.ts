/**
 * Inbound email authentication gate (support platform §4.8). Cold inbound email
 * can spoof its From, so before an unknown sender is trusted we read the
 * Authentication-Results header the receiving MTA stamped and turn it into a
 * trust verdict. We do NOT verify SPF/DKIM/ARC ourselves (no DNS lookups, no
 * signature math, no seal validation) — a missing or unparseable header is
 * simply untrusted.
 *
 * The verdict is consumed split-by-action by the cold-inbound path:
 *   - pass       → DMARC-aligned; may ATTACH to an identified principal/company.
 *   - unverified → create a standalone contact with an "unverified sender" badge;
 *                  never auto-attach to an existing identity.
 *   - reject     → hard DMARC reject (fail under a p=reject policy); drop outright.
 *
 * ARC (RFC 8617) is why `reject` is not the end of the story. Forwarding ALWAYS
 * breaks SPF alignment, and breaks DKIM as soon as the forwarder touches the
 * message (a security gateway prepending a banner or rewriting links, a mailing
 * list adding a footer). So a legitimate message relayed through a customer's
 * own gateway arrives DMARC-failing under the author domain's p=reject policy,
 * and dropping it is dropping real mail. ARC exists exactly for that case: an
 * intermediary records the authentication results it observed, and a downstream
 * receiver that validates the chain can honour the earlier verdict. Our MTA
 * evaluates the chain and reports the outcome as `arc=` in the same header.
 *
 * A validated chain downgrades `reject` to `unverified`. It NEVER produces
 * `pass`, and that line is the whole design rather than caution for its own
 * sake: `pass` is an AUTHORIZATION decision (it permits attaching this mail to
 * an existing identity by address), while `arc=pass` only says some earlier hop
 * vouched for a message we cannot ourselves tie to the From domain. Accept it,
 * badge it, never adopt an identity on it.
 *
 * This is a pure function so it unit-tests exhaustively against real header
 * shapes.
 */

export type InboundAuthVerdict = 'pass' | 'unverified' | 'reject'
export type DmarcResult = 'pass' | 'fail' | 'none' | 'unknown'
export type DmarcPolicy = 'reject' | 'quarantine' | 'none'
/**
 * `arc=` as OUR receiving MTA reported it: its verdict on validating the chain,
 * never a claim read out of the chain itself. `ARC-Authentication-Results` is
 * written by the intermediary and is unauthenticated as far as this code is
 * concerned, so it is deliberately not a source here.
 */
export type ArcResult = 'pass' | 'fail' | 'none' | 'unknown'
/** Microsoft composite authentication (`compauth=`), carried by mail relayed
 *  through Exchange Online. Recorded, never decisive — see {@link InboundAuthResult}. */
export type CompauthResult = 'pass' | 'fail' | 'softpass' | 'none' | 'unknown'

export interface InboundAuthResult {
  verdict: InboundAuthVerdict
  dmarc: DmarcResult
  /** The published DMARC policy the MTA noted (p=…), when present. */
  policy: DmarcPolicy | null
  /** The MTA's own ARC chain verdict from the same header. */
  arc: ArcResult
  /**
   * `compauth=` and its `reason=` code, when the receiving MTA stamps them.
   * Observational only: it is a vendor composite that already folds DMARC in
   * alongside heuristics, so letting it move this gate would both duplicate the
   * DMARC branch and make our trust boundary depend on another vendor's tuning.
   * It is captured because it is the one field that explains WHY Exchange Online
   * scored a forwarded message the way it did, which is what an agent looking at
   * an unverified badge (or someone reading the audit trail later) needs.
   */
  compauth: CompauthResult
  compauthReason: string | null
  /**
   * True when a validated ARC chain is the only reason this message was not
   * dropped. Exposed as a field rather than left for callers to re-derive from
   * (dmarc, policy, arc): it is the fact the badge and the audit trail are about,
   * and a condition re-spelled at each call site is a condition that drifts.
   */
  arcRescued: boolean
  /** Short human-readable reason, for the agent-facing sender badge / audit. */
  reason: string
}

/**
 * One `;`-separated methodspec from an Authentication-Results value.
 *
 * Two views of the same text, because the header mixes grammar with free text:
 * `bare` has comments and quoted strings blanked out and is what any token is
 * matched against, while `full` keeps them so the DMARC policy comment
 * (`dmarc=fail (p=reject …)`) can still be read.
 */
interface AuthSegment {
  bare: string
  full: string
}

/**
 * Reduce a raw header value to the TOPMOST Authentication-Results instance and
 * split it into its top-level methodspecs.
 *
 * RFC 8601 §5 is blunt about why: a receiver MUST delete or ignore any
 * Authentication-Results it did not add, because anyone can type one. Ours is
 * the one our own MTA prepended, which makes it the first in the message and the
 * first this function sees. Everything after it is the sender's to write.
 *
 * The instance boundary is enforced HERE, and not merely trusted from the
 * caller, because this function is the trust decision. Today's callers do hand
 * over the topmost header, but that safety lives in a generic header reader
 * shared with Subject and From, where nothing records that a security boundary
 * depends on its ordering. A caller that ever passes two instances joined (a
 * header map that collapses duplicates, the way `Headers.get()` does; a raw
 * block round-tripped for debugging) would otherwise let a stranger's own
 * `dmarc=pass` or `arc=pass` decide the verdict.
 *
 * Structure is tracked rather than pattern-matched for the same reason. An MTA
 * echoes attacker-chosen text into this header (the envelope sender, the From
 * domain), a quoted local-part may legally contain `;` and `=`, and an ARC
 * comment legitimately contains the words `dmarc=pass` describing a DIFFERENT
 * hop. A scan that matched a token anywhere in the raw value lets any of those
 * three write our verdict for us.
 */
function topmostSegments(raw: string): AuthSegment[] {
  // Unfold first: continuation lines (RFC 5322 folding) belong to this header,
  // but the first line that is NOT a continuation is a different header, and a
  // different header is not ours.
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  let value = lines[0] ?? ''
  for (let i = 1; i < lines.length; i++) {
    if (!/^[ \t]/.test(lines[i]!)) break
    value += ' ' + lines[i]!.trim()
  }

  // Tolerate a caller that kept the field name, then cut at any later one. The
  // cut deliberately also fires on `ARC-Authentication-Results:` and any other
  // `*-authentication-results:` prefix: those are written by the sending side
  // and we have validated nothing about them. A value that IS such a header
  // therefore reduces to nothing, which reads as "no header" rather than as a
  // verdict, and that is the correct answer for a claim we cannot check.
  value = value.replace(/^[ \t]*authentication-results[ \t]*:/i, '')
  const laterHeader = /(?:[a-z0-9-]+-)?authentication-results[ \t]*:/i.exec(value)
  if (laterHeader) value = value.slice(0, laterHeader.index)

  const segments: AuthSegment[] = []
  let bare = ''
  let full = ''
  let depth = 0
  let quoted = false
  const push = (): void => {
    segments.push({ bare: bare.trim(), full: full.trim() })
    bare = ''
    full = ''
  }

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    if (quoted) {
      full += ch
      bare += ' '
      if (ch === '\\' && i + 1 < value.length) {
        full += value[i + 1]!
        bare += ' '
        i++
        continue
      }
      if (ch === '"') quoted = false
      continue
    }
    if (depth > 0) {
      full += ch
      bare += ' '
      if (ch === '(') depth++
      else if (ch === ')') depth--
      continue
    }
    if (ch === '"') {
      quoted = true
      full += ch
      bare += ' '
      continue
    }
    if (ch === '(') {
      depth++
      full += ch
      bare += ' '
      continue
    }
    if (ch === ';') {
      push()
      continue
    }
    if (ch === ',') {
      // A comma at the top level cannot occur inside one value: RFC 8601 builds
      // every field from RFC 2045 tokens, and `,` is a tspecial, so it appears
      // only inside a comment or a quoted string — both already consumed above.
      // Reaching here means someone joined instances, so the first one ends.
      push()
      return segments
    }
    full += ch
    bare += ch
  }
  push()
  return segments
}

/** The result token of the first segment declaring `method`, or null. A
 *  methodspec is the LEADING token of its segment; anything later in the segment
 *  is a propspec (`ptype.property=value`) and must never be read as a method. */
function methodSpec(
  segments: AuthSegment[],
  method: string
): { result: string; segment: AuthSegment } | null {
  for (const segment of segments) {
    const match = /^([a-z0-9-]+)\s*=\s*([a-z0-9]+)/.exec(segment.bare)
    if (match && match[1] === method) return { result: match[2]!, segment }
  }
  return null
}

function asDmarc(result: string | undefined): DmarcResult {
  return result === 'pass' || result === 'fail' || result === 'none' ? result : 'unknown'
}

function asArc(result: string | undefined): ArcResult {
  return result === 'pass' || result === 'fail' || result === 'none' ? result : 'unknown'
}

function asCompauth(result: string | undefined): CompauthResult {
  return result === 'pass' || result === 'fail' || result === 'softpass' || result === 'none'
    ? result
    : 'unknown'
}

/**
 * Evaluate an inbound message's Authentication-Results header into a trust
 * verdict. `null` (header absent) is untrusted, not an error.
 */
export function evaluateInboundAuth(authResultsHeader: string | null): InboundAuthResult {
  const segments = authResultsHeader ? topmostSegments(authResultsHeader.toLowerCase()) : []
  const dmarcSpec = methodSpec(segments, 'dmarc')
  const arcSpec = methodSpec(segments, 'arc')
  const compauthSpec = methodSpec(segments, 'compauth')

  const dmarc = asDmarc(dmarcSpec?.result)
  const arc = asArc(arcSpec?.result)
  const compauth = asCompauth(compauthSpec?.result)
  // Read from `bare`, so a reason code sitting inside a comment or a quoted
  // string is not mistaken for the one the MTA wrote.
  const compauthReason = compauthSpec
    ? (/\breason=(\d+)/.exec(compauthSpec.segment.bare)?.[1] ?? null)
    : null
  // The published policy the MTA echoed in the dmarc comment, e.g.
  // dmarc=fail (p=reject …). Scoped to the dmarc segment: `p=` also appears in
  // other methods' comments, and an ARC comment carries a whole nested result set.
  const policyMatch = dmarcSpec
    ? /^dmarc=\w+\s*\([^)]*\bp=(reject|quarantine|none)\b/.exec(dmarcSpec.segment.full)
    : null
  const policy = (policyMatch?.[1] as DmarcPolicy | undefined) ?? null

  // Appended to every reason so the badge and the audit trail carry the one
  // field that explains an Exchange Online score, when there is one.
  const detail = compauthSpec
    ? `; compauth=${compauth}${compauthReason ? ` reason=${compauthReason}` : ''}`
    : ''
  const base = {
    dmarc,
    policy,
    arc,
    compauth,
    compauthReason,
  }

  if (segments.every((segment) => segment.bare === '')) {
    return {
      ...base,
      verdict: 'unverified',
      arcRescued: false,
      reason: 'no Authentication-Results header',
    }
  }

  if (dmarc === 'pass') {
    // DMARC pass already implies SPF-or-DKIM alignment with the From domain.
    return { ...base, verdict: 'pass', arcRescued: false, reason: `DMARC pass (aligned)${detail}` }
  }
  if (dmarc === 'fail' && policy === 'reject') {
    if (arc === 'pass') {
      // Downgraded, not upgraded. The chain says an earlier hop authenticated
      // this message; it says nothing that ties the message to the From domain
      // now, which is the only thing `pass` is allowed to mean here.
      return {
        ...base,
        verdict: 'unverified',
        arcRescued: true,
        reason: `DMARC fail under p=reject, accepted on a validated ARC chain (arc=pass); sender not verified${detail}`,
      }
    }
    return {
      ...base,
      verdict: 'reject',
      arcRescued: false,
      reason: `DMARC fail under p=reject${detail}`,
    }
  }
  // fail under quarantine/none, none, neutral, temp/permerror, or an
  // unparseable result: untrusted but not dropped — created with a badge.
  return {
    ...base,
    verdict: 'unverified',
    arcRescued: false,
    reason:
      (dmarc === 'fail'
        ? `DMARC fail (p=${policy ?? 'unspecified'})`
        : dmarc === 'none'
          ? 'no DMARC alignment'
          : 'DMARC result absent or inconclusive') + detail,
  }
}
