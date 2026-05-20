/**
 * Unit tests for the DNS TXT verification helper.
 *
 * Mocks `node:dns/promises` so we can simulate the four reachability
 * states (records / NXDOMAIN / generic failure / timeout) without
 * touching real DNS in CI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockResolveTxt: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  resolveTxt: hoisted.mockResolveTxt,
}))

const { lookupVerificationTxt } = await import('../dns-verify')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lookupVerificationTxt', () => {
  it('returns ok=true with joined values for a single chunked record', async () => {
    hoisted.mockResolveTxt.mockResolvedValue([['qb-domain-verify=', 'tok123']])
    const result = await lookupVerificationTxt('_quackback-verify.acme.com')
    expect(result).toEqual({ ok: true, values: ['qb-domain-verify=tok123'] })
  })

  it('returns ok=true with multiple records', async () => {
    hoisted.mockResolveTxt.mockResolvedValue([
      ['v=spf1 include:_spf.google.com ~all'],
      ['qb-domain-verify=tok123'],
    ])
    const result = await lookupVerificationTxt('_quackback-verify.acme.com')
    expect(result).toEqual({
      ok: true,
      values: ['v=spf1 include:_spf.google.com ~all', 'qb-domain-verify=tok123'],
    })
  })

  it('returns no-record when resolveTxt returns empty', async () => {
    hoisted.mockResolveTxt.mockResolvedValue([])
    const result = await lookupVerificationTxt('_quackback-verify.acme.com')
    expect(result).toEqual({ ok: false, reason: 'no-record' })
  })

  it('returns no-record on ENOTFOUND', async () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
    hoisted.mockResolveTxt.mockRejectedValue(err)
    const result = await lookupVerificationTxt('_quackback-verify.acme.com')
    expect(result).toEqual({ ok: false, reason: 'no-record' })
  })

  it('returns no-record on ENODATA', async () => {
    const err = Object.assign(new Error('no data'), { code: 'ENODATA' })
    hoisted.mockResolveTxt.mockRejectedValue(err)
    const result = await lookupVerificationTxt('_quackback-verify.acme.com')
    expect(result).toEqual({ ok: false, reason: 'no-record' })
  })

  it('returns lookup-failed on unknown errors', async () => {
    hoisted.mockResolveTxt.mockRejectedValue(new Error('SERVFAIL'))
    const result = await lookupVerificationTxt('_quackback-verify.acme.com')
    expect(result).toEqual({ ok: false, reason: 'lookup-failed' })
  })
})
