/**
 * Unit coverage for the inbound email authentication gate (§4.8): DMARC pass
 * attaches, hard reject drops, everything weak (fail-not-reject, none, missing,
 * malformed) is unverified. Real Authentication-Results header shapes.
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
    })
  })

  it('rejects a hard DMARC fail under p=reject', () => {
    const h =
      'mx.quackback.io; spf=fail smtp.mailfrom=spoof.com; dkim=none; dmarc=fail (p=reject dis=reject) header.from=acme.com'
    expect(evaluateInboundAuth(h)).toMatchObject({
      verdict: 'reject',
      dmarc: 'fail',
      policy: 'reject',
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
