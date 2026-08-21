/**
 * Unit coverage for the inbound email authentication gate (§4.8): DMARC pass
 * attaches, hard reject drops, everything weak (fail-not-reject, none, missing,
 * malformed) is unverified, and a validated ARC chain downgrades a drop to a
 * badge without ever reaching `pass`. Real Authentication-Results header shapes
 * throughout, including captured Exchange Online ones.
 */
import { describe, it, expect } from 'vitest'
import { evaluateInboundAuth } from '../email-auth'

describe('evaluateInboundAuth', () => {
  it('passes a DMARC-aligned message', () => {
    const h =
      'mx.quackback.io; spf=pass smtp.mailfrom=acme.com; dkim=pass header.d=acme.com; dmarc=pass (p=reject sp=reject dis=none) header.from=acme.com'
    expect(evaluateInboundAuth(h)).toMatchObject({
      verdict: 'pass',
      dmarc: 'pass',
      policy: 'reject',
      arcRescued: false,
    })
  })

  it('rejects a hard DMARC fail under p=reject', () => {
    const h =
      'mx.quackback.io; spf=fail smtp.mailfrom=spoof.com; dkim=none; dmarc=fail (p=reject dis=reject) header.from=acme.com'
    expect(evaluateInboundAuth(h)).toMatchObject({
      verdict: 'reject',
      dmarc: 'fail',
      policy: 'reject',
      arc: 'unknown',
      arcRescued: false,
    })
  })

  it('treats a DMARC fail under quarantine/none as unverified, not dropped', () => {
    const quarantine = 'mx; dmarc=fail (p=quarantine) header.from=acme.com'
    expect(evaluateInboundAuth(quarantine)).toMatchObject({
      verdict: 'unverified',
      dmarc: 'fail',
      policy: 'quarantine',
    })
    const none = 'mx; dmarc=fail (p=none) header.from=acme.com'
    expect(evaluateInboundAuth(none)).toMatchObject({
      verdict: 'unverified',
      dmarc: 'fail',
      policy: 'none',
    })
  })

  it('treats dmarc=none (no alignment) as unverified', () => {
    expect(evaluateInboundAuth('mx; spf=pass smtp.mailfrom=x.com; dmarc=none')).toMatchObject({
      verdict: 'unverified',
      dmarc: 'none',
    })
  })

  it('treats a missing or empty header as unverified (we do not verify ourselves)', () => {
    expect(evaluateInboundAuth(null)).toMatchObject({ verdict: 'unverified', dmarc: 'unknown' })
    expect(evaluateInboundAuth('   ')).toMatchObject({ verdict: 'unverified', dmarc: 'unknown' })
  })

  it('is case-insensitive and tolerates an unparseable dmarc token', () => {
    expect(evaluateInboundAuth('MX; SPF=PASS; DMARC=PASS header.from=acme.com').verdict).toBe(
      'pass'
    )
    // A result with no recognizable dmarc token -> unknown -> unverified (never a
    // false pass/reject).
    expect(evaluateInboundAuth('mx; spf=pass; dkim=pass')).toMatchObject({
      verdict: 'unverified',
      dmarc: 'unknown',
    })
  })
})

describe('evaluateInboundAuth — ARC (forwarded mail)', () => {
  // Forwarding breaks SPF alignment always and DKIM whenever the forwarder edits
  // the message, so this is what a real mail relayed through a customer's own
  // security gateway looks like when it reaches us.
  const forwarded =
    'mx.quackback.io; spf=fail smtp.mailfrom=gateway.example; dkim=fail header.d=acme.com; dmarc=fail (p=reject dis=reject) header.from=acme.com; arc=pass (i=1 spf=pass dkim=pass dmarc=pass)'

  it('downgrades a hard reject to unverified on a validated ARC chain', () => {
    const result = evaluateInboundAuth(forwarded)
    expect(result).toMatchObject({
      verdict: 'unverified',
      dmarc: 'fail',
      policy: 'reject',
      arc: 'pass',
      arcRescued: true,
    })
    // The reason reaches an agent-facing badge and the audit trail, so it has to
    // say that ARC is what saved the message.
    expect(result.reason).toContain('ARC')
    expect(result.reason).toContain('arc=pass')
  })

  it('never lets ARC produce a pass', () => {
    // The rescue case itself.
    expect(evaluateInboundAuth(forwarded).verdict).not.toBe('pass')
    // And every weaker DMARC outcome alongside a validated chain.
    for (const header of [
      'mx; dmarc=none; arc=pass (i=1 spf=pass dkim=pass dmarc=pass)',
      'mx; dmarc=fail (p=quarantine) header.from=acme.com; arc=pass',
      'mx; spf=pass smtp.mailfrom=x.com; arc=pass',
      'mx; arc=pass',
    ]) {
      expect(evaluateInboundAuth(header)).toMatchObject({
        verdict: 'unverified',
        arcRescued: false,
      })
    }
  })

  it('still drops a hard reject when the chain did not validate', () => {
    const base =
      'mx.quackback.io; spf=fail smtp.mailfrom=gateway.example; dkim=fail header.d=acme.com; dmarc=fail (p=reject dis=reject) header.from=acme.com'
    for (const arc of ['', '; arc=fail', '; arc=none (0)', '; arc=permerror']) {
      expect(evaluateInboundAuth(base + arc)).toMatchObject({
        verdict: 'reject',
        arcRescued: false,
      })
    }
  })

  it('reads arc only from a leading methodspec, never from a propspec or a comment', () => {
    const base =
      'mx.quackback.io; spf=fail; dkim=fail; dmarc=fail (p=reject dis=reject) header.from=acme.com'
    // `arc=pass` glued onto another method's property list is not a methodspec.
    expect(evaluateInboundAuth(`${base}; dkim=fail header.d=acme.com arc=pass`).verdict).toBe(
      'reject'
    )
    // Inside a comment it is prose about a different hop, not our MTA's verdict.
    expect(evaluateInboundAuth(`${base}; dkim=fail (arc=pass on the way in)`).verdict).toBe(
      'reject'
    )
  })

  it('ignores an arc token an MTA echoed out of attacker-chosen text', () => {
    // The envelope sender lands in the header verbatim, and a quoted local-part
    // may legally contain `;` and `=` — so a sender can name their own mailbox
    // after the token they want us to read.
    const echoed =
      'mx.quackback.io; spf=fail smtp.mailfrom="x; arc=pass"@evil.example; dmarc=fail (p=reject dis=reject) header.from=acme.com'
    expect(evaluateInboundAuth(echoed)).toMatchObject({
      verdict: 'reject',
      arc: 'unknown',
      arcRescued: false,
    })
  })
})

describe('evaluateInboundAuth — Exchange Online shapes', () => {
  // Captured from a real message: note the lowercase field name, the `;` with no
  // following space, and `cv=none` on the seal marking the first chain hop.
  const captured =
    'dkim=none (message not signed) header.d=none;dmarc=none action=none header.from=quackback.io;'

  it('reads a captured Exchange Online authentication-results', () => {
    expect(evaluateInboundAuth(captured)).toMatchObject({
      verdict: 'unverified',
      dmarc: 'none',
      arc: 'unknown',
      compauth: 'unknown',
      compauthReason: null,
    })
  })

  it('records compauth and its reason code without letting it move the verdict', () => {
    const h =
      'spf=pass (sender ip is 40.107.0.1) smtp.mailfrom=contoso.com; dkim=pass (signature was verified) header.d=contoso.com;dmarc=fail action=oreject header.from=contoso.com;compauth=fail reason=001'
    const result = evaluateInboundAuth(h)
    expect(result).toMatchObject({
      // No `p=` comment, so no policy, so this is a badge and not a drop — the
      // compauth failure does not add one.
      verdict: 'unverified',
      dmarc: 'fail',
      policy: null,
      compauth: 'fail',
      compauthReason: '001',
    })
    expect(result.reason).toContain('compauth=fail reason=001')

    // compauth=pass cannot manufacture a pass either.
    const softpass =
      'spf=softfail smtp.mailfrom=contoso.com;dmarc=none action=none header.from=contoso.com;compauth=softpass reason=202'
    expect(evaluateInboundAuth(softpass)).toMatchObject({
      verdict: 'unverified',
      compauth: 'softpass',
      compauthReason: '202',
    })
  })

  it('never reads a sender-written ARC-Authentication-Results as our own verdict', () => {
    // Captured alongside the header above. Every token in it is written by the
    // intermediary and validated by nobody here, so it must contribute nothing.
    const arcAuthResults =
      'ARC-Authentication-Results: i=1; mx.microsoft.com 1; spf=pass smtp.mailfrom=quackback.io; dmarc=pass action=none header.from=quackback.io; dkim=pass header.d=quackback.io; arc=none'
    expect(evaluateInboundAuth(arcAuthResults)).toMatchObject({
      verdict: 'unverified',
      dmarc: 'unknown',
      arc: 'unknown',
      reason: 'no Authentication-Results header',
    })
  })
})

describe('evaluateInboundAuth — only the topmost instance counts', () => {
  // RFC 8601 §5: a receiver ignores any Authentication-Results it did not add.
  // Ours is the one our MTA prepended, so it is the first one.
  const ourReject =
    'mx.quackback.io; spf=fail smtp.mailfrom=spoof.example; dkim=none; dmarc=fail (p=reject dis=reject) header.from=acme.com'
  const forged = 'mx.quackback.io; dmarc=pass header.from=acme.com; arc=pass'

  it('ignores a second instance joined onto the value', () => {
    expect(evaluateInboundAuth(`${ourReject}, ${forged}`)).toMatchObject({
      verdict: 'reject',
      dmarc: 'fail',
      arc: 'unknown',
    })
  })

  it('does not let a second instance supply a token the topmost one lacks', () => {
    // The dangerous shape: our MTA reported no DMARC at all, so a scan of the
    // whole string would find only the forged token and read it as ours.
    const ourPartial = 'mx.quackback.io; spf=fail smtp.mailfrom=spoof.example'
    expect(evaluateInboundAuth(`${ourPartial}, ${forged}`)).toMatchObject({
      verdict: 'unverified',
      dmarc: 'unknown',
      arc: 'unknown',
    })
  })

  it('ignores a second instance that arrives as a further header line', () => {
    const block = `${ourReject}\r\nAuthentication-Results: ${forged}`
    expect(evaluateInboundAuth(block)).toMatchObject({ verdict: 'reject', arc: 'unknown' })
  })

  it('keeps a folded continuation of the topmost instance', () => {
    // Folding is one header split over lines, so the continuation is still ours
    // and dropping it would lose the policy that makes this a drop.
    const folded =
      'mx.quackback.io; spf=fail smtp.mailfrom=spoof.example; dkim=none;\r\n dmarc=fail (p=reject dis=reject) header.from=acme.com'
    expect(evaluateInboundAuth(folded)).toMatchObject({ verdict: 'reject', policy: 'reject' })
  })

  it('tolerates the field name being left on the value', () => {
    expect(evaluateInboundAuth(`Authentication-Results: ${ourReject}`).verdict).toBe('reject')
  })

  it('does not read a nested DMARC result out of an ARC comment', () => {
    // An ARC comment legitimately spells out the results of an EARLIER hop. Read
    // as our MTA's own verdict it turns a hard failure into an aligned pass.
    const arcFirst =
      'mx.quackback.io; arc=pass (i=1 spf=pass dkim=pass dmarc=pass); dmarc=fail (p=reject dis=reject) header.from=acme.com'
    expect(evaluateInboundAuth(arcFirst)).toMatchObject({
      verdict: 'unverified',
      dmarc: 'fail',
      arc: 'pass',
      arcRescued: true,
    })
  })
})
