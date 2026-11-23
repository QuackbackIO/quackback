// @vitest-environment node
/**
 * The identity-provider callers of the SSRF guard may reach the e2e suite's
 * own https OIDC provider fake, behind the harness gate. Everything else, and
 * every other caller, stays refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkUrlSafety, safeFetch } from '../ssrf-guard'

vi.mock('node:dns/promises', () => ({ default: {}, lookup: vi.fn() }))
const httpsRequestMock = vi.fn()
vi.mock('node:https', () => ({ default: {}, request: (...a: unknown[]) => httpsRequestMock(...a) }))

import { lookup } from 'node:dns/promises'
const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>

const FAKE = 'https://oidc-fake.localhost:4014/abc/.well-known/openid-configuration'
const GATE_ENV: Record<string, string> = {
  E2E_HARNESS: '1',
  BASE_URL: 'http://acme.localhost:3000',
  E2E_OIDC_FAKE_HOST: 'oidc-fake.localhost:4014',
  E2E_WEBHOOK_SINK_HOST: 'webhook-sink.localhost:4011',
}
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  lookupMock.mockReset()
  httpsRequestMock.mockReset()
  for (const key of [...Object.keys(GATE_ENV), 'QUACKBACK_TENANCY']) saved[key] = process.env[key]
  Object.assign(process.env, GATE_ENV)
  delete process.env.QUACKBACK_TENANCY
})

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('checkUrlSafety e2e OIDC provider fake allowance', () => {
  it('accepts the fake on loopback when an identity-provider caller asks and the gate is open', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    expect(await checkUrlSafety(FAKE, { allowE2eOidcFake: true })).toEqual({
      safe: true,
      address: '127.0.0.1',
      family: 4,
    })
  })

  it('refuses the fake when the caller did not ask (every other guard user)', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    expect(await checkUrlSafety(FAKE)).toEqual({ safe: false, reason: 'ssrf-rejected' })
    await expect(safeFetch(FAKE)).rejects.toMatchObject({ reason: 'ssrf-rejected' })
    // The webhook sink's allowance does not open the OIDC fake either.
    await expect(safeFetch(FAKE, { allowE2eWebhookSink: true })).rejects.toMatchObject({
      reason: 'ssrf-rejected',
    })
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('refuses the fake without the harness flag', async () => {
    delete process.env.E2E_HARNESS
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    expect(await checkUrlSafety(FAKE, { allowE2eOidcFake: true })).toEqual({
      safe: false,
      reason: 'ssrf-rejected',
    })
  })

  it('refuses the fake with the flag on a public BASE_URL (a real deployment)', async () => {
    process.env.BASE_URL = 'https://feedback.example.com'
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    expect(await checkUrlSafety(FAKE, { allowE2eOidcFake: true })).toEqual({
      safe: false,
      reason: 'ssrf-rejected',
    })
    await expect(safeFetch(FAKE, { allowE2eOidcFake: true })).rejects.toMatchObject({
      reason: 'ssrf-rejected',
    })
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('refuses the fake on the pooled fleet', async () => {
    process.env.QUACKBACK_TENANCY = 'pooled'
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    expect(await checkUrlSafety(FAKE, { allowE2eOidcFake: true })).toMatchObject({ safe: false })
  })

  it('refuses the fake name when any address it resolves to is private but not loopback', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '127.0.0.1', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    expect(await checkUrlSafety(FAKE, { allowE2eOidcFake: true })).toEqual({
      safe: false,
      reason: 'ssrf-rejected',
    })
  })

  it('still refuses every other private or http identity-provider URL', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    for (const url of [
      'http://oidc-fake.localhost:4014/abc',
      'https://other.localhost:4014/',
      'https://oidc-fake.localhost:9999/',
      'https://localhost:4014/',
      'https://127.0.0.1:4014/',
      'https://webhook-sink.localhost:4011/',
    ]) {
      const verdict = await checkUrlSafety(url, { allowE2eOidcFake: true })
      expect(verdict.safe, url).toBe(false)
    }
  })
})
