/**
 * Tests for Slack request signature verification.
 */

import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifySlackSignature } from '../verify'

const SIGNING_SECRET = 'test-signing-secret-1234'

function makeSignature(body: string, timestamp: string, secret = SIGNING_SECRET): string {
  const basestring = `v0:${timestamp}:${body}`
  return `v0=${createHmac('sha256', secret).update(basestring).digest('hex')}`
}

function nowTimestamp(): string {
  return String(Math.floor(Date.now() / 1000))
}

describe('verifySlackSignature', () => {
  it('returns true for a valid signature', () => {
    const body = 'payload=test'
    const ts = nowTimestamp()
    const sig = makeSignature(body, ts)

    expect(verifySlackSignature(body, ts, sig, SIGNING_SECRET)).toBe(true)
  })

  it('returns 401 when timestamp header is missing', () => {
    const result = verifySlackSignature('body', null, 'v0=abc', SIGNING_SECRET)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 when signature header is missing', () => {
    const result = verifySlackSignature('body', nowTimestamp(), null, SIGNING_SECRET)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 when both headers are missing', () => {
    const result = verifySlackSignature('body', null, null, SIGNING_SECRET)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 when timestamp is not a number', () => {
    const result = verifySlackSignature('body', 'not-a-number', 'v0=abc', SIGNING_SECRET)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 when timestamp is too old (replay attack)', () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 6 * 60) // 6 minutes ago
    const body = 'payload=test'
    const sig = makeSignature(body, oldTs)

    const result = verifySlackSignature(body, oldTs, sig, SIGNING_SECRET)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 when timestamp is in the far future', () => {
    const futureTs = String(Math.floor(Date.now() / 1000) + 6 * 60) // 6 minutes from now
    const body = 'payload=test'
    const sig = makeSignature(body, futureTs)

    const result = verifySlackSignature(body, futureTs, sig, SIGNING_SECRET)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('accepts timestamps within the 5-minute window', () => {
    const recentTs = String(Math.floor(Date.now() / 1000) - 4 * 60) // 4 minutes ago
    const body = 'payload=test'
    const sig = makeSignature(body, recentTs)

    expect(verifySlackSignature(body, recentTs, sig, SIGNING_SECRET)).toBe(true)
  })

  it('returns 401 when signature is invalid', () => {
    const body = 'payload=test'
    const ts = nowTimestamp()

    const result = verifySlackSignature(body, ts, 'v0=deadbeef', SIGNING_SECRET)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 when body has been tampered with', () => {
    const body = 'payload=test'
    const ts = nowTimestamp()
    const sig = makeSignature(body, ts)

    const result = verifySlackSignature('payload=tampered', ts, sig, SIGNING_SECRET)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 when signing secret is wrong', () => {
    const body = 'payload=test'
    const ts = nowTimestamp()
    const sig = makeSignature(body, ts, 'correct-secret')

    const result = verifySlackSignature(body, ts, sig, 'wrong-secret')
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('handles empty body correctly', () => {
    const body = ''
    const ts = nowTimestamp()
    const sig = makeSignature(body, ts)

    expect(verifySlackSignature(body, ts, sig, SIGNING_SECRET)).toBe(true)
  })
})
