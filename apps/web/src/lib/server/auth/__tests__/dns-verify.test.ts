/**
 * Unit tests for the DNS TXT verification helper.
 *
 * Replaces the shared resolver so the reachability states (records /
 * NXDOMAIN / generic failure) can be simulated without touching real DNS.
 * The fake records the name it was asked, so a lookup that went around the
 * shared resolver, or asked the wrong name, fails here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockResolveTxt: vi.fn(),
}))

vi.mock('@/lib/server/dns/resolver', () => ({
  systemResolver: { resolveTxt: hoisted.mockResolveTxt },
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
    expect(hoisted.mockResolveTxt.mock.calls).toEqual([['_quackback-verify.acme.com']])
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

describe('lookupVerificationTxt resolver', () => {
  it('reads through the resolver it is given', async () => {
    const given = { resolveTxt: vi.fn(async () => [['qb-domain-verify=x']]) }
    const result = await lookupVerificationTxt('_quackback-verify.acme.com', given as never)
    expect(result).toEqual({ ok: true, values: ['qb-domain-verify=x'] })
    expect(given.resolveTxt).toHaveBeenCalledWith('_quackback-verify.acme.com')
    expect(hoisted.mockResolveTxt).not.toHaveBeenCalled()
  })
})
