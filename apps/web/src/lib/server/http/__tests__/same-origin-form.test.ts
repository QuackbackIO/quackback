// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signCustomerHost } from '@/lib/server/workspaces/saas-edge-host'
import { isSameOriginFormPost, originMatchesRequestHost } from '../same-origin-form'

describe('originMatchesRequestHost', () => {
  it('accepts a browser https Origin against the public Host', () => {
    expect(
      originMatchesRequestHost('https://south63792f.quackback.co.uk', 'south63792f.quackback.co.uk')
    ).toBe(true)
  })

  it('accepts localhost http (self-host)', () => {
    expect(originMatchesRequestHost('http://localhost:3000', 'localhost:3000')).toBe(true)
  })

  it('refuses a missing Origin, a foreign Origin, and a suffix host', () => {
    expect(originMatchesRequestHost(null, 'south63792f.quackback.co.uk')).toBe(false)
    expect(originMatchesRequestHost('https://attacker.test', 'south63792f.quackback.co.uk')).toBe(
      false
    )
    expect(
      originMatchesRequestHost(
        'https://south63792f.quackback.co.uk.attacker.test',
        'south63792f.quackback.co.uk'
      )
    ).toBe(false)
  })

  it('uses the first forwarded host when a proxy lists several', () => {
    expect(
      originMatchesRequestHost(
        'https://south63792f.quackback.co.uk',
        'south63792f.quackback.co.uk, 127.0.0.1:3000'
      )
    ).toBe(true)
  })
})

describe('isSameOriginFormPost', () => {
  const SECRET = 'test-edge-secret'
  const RAILWAY = 'app.up.example'
  const CUSTOMER = 'shop.customer.test'

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function formPost(headers: Record<string, string>): Request {
    return new Request('https://app.up.example/api/billing/session', {
      method: 'POST',
      headers,
    })
  }

  it('accepts a first-party Host that matches Origin', () => {
    expect(
      isSameOriginFormPost(
        formPost({
          origin: 'https://south63792f.quackback.co.uk',
          host: 'south63792f.quackback.co.uk',
        })
      )
    ).toBe(true)
  })

  it('accepts a custom domain whose Host is the Railway hop', () => {
    vi.stubEnv('QUACKBACK_SAAS_RAILWAY_ORIGIN', RAILWAY)
    vi.stubEnv('QUACKBACK_SAAS_EDGE_SECRET', SECRET)
    expect(
      isSameOriginFormPost(
        formPost({
          origin: `https://${CUSTOMER}`,
          host: RAILWAY,
          'x-forwarded-host': RAILWAY,
          'x-quackback-customer-host': CUSTOMER,
          'x-quackback-customer-host-sig': signCustomerHost(SECRET, CUSTOMER),
        })
      )
    ).toBe(true)
  })

  it('refuses a custom-domain Origin when the customer-host HMAC is wrong', () => {
    vi.stubEnv('QUACKBACK_SAAS_RAILWAY_ORIGIN', RAILWAY)
    vi.stubEnv('QUACKBACK_SAAS_EDGE_SECRET', SECRET)
    expect(
      isSameOriginFormPost(
        formPost({
          origin: `https://${CUSTOMER}`,
          host: RAILWAY,
          'x-forwarded-host': RAILWAY,
          'x-quackback-customer-host': CUSTOMER,
          'x-quackback-customer-host-sig': '00'.repeat(32),
        })
      )
    ).toBe(false)
  })

  it('refuses a foreign Origin even when a signed customer host is present', () => {
    vi.stubEnv('QUACKBACK_SAAS_RAILWAY_ORIGIN', RAILWAY)
    vi.stubEnv('QUACKBACK_SAAS_EDGE_SECRET', SECRET)
    expect(
      isSameOriginFormPost(
        formPost({
          origin: 'https://attacker.test',
          host: RAILWAY,
          'x-quackback-customer-host': CUSTOMER,
          'x-quackback-customer-host-sig': signCustomerHost(SECRET, CUSTOMER),
        })
      )
    ).toBe(false)
  })
})
