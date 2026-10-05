import { describe, expect, it } from 'vitest'
import {
  edgeClientIp,
  requestWorkspaceHost,
  signCustomerHost,
  signEdgeClientIp,
  verifyCustomerHostSignature,
} from '../saas-edge-host'

const SECRET = 'test-edge-secret'
const CUSTOMER = 'shop.customer.test'
const RAILWAY = 'app.up.example'
const FIRST_PARTY = 'south.saas.example'

function request(host: string, headers: Record<string, string> = {}) {
  return new Request(`http://${host}/`, { headers: { host, ...headers } })
}

describe('saas-edge-host', () => {
  it('signs and verifies the customer-host HMAC', () => {
    const sig = signCustomerHost(SECRET, CUSTOMER)
    expect(verifyCustomerHostSignature(SECRET, CUSTOMER, sig)).toBe(true)
    expect(verifyCustomerHostSignature(SECRET, CUSTOMER, '00'.repeat(32))).toBe(false)
    expect(verifyCustomerHostSignature('', CUSTOMER, sig)).toBe(false)
  })

  it('uses the signed customer host only on a trusted Railway origin', () => {
    const sig = signCustomerHost(SECRET, CUSTOMER)
    const env = {
      QUACKBACK_SAAS_RAILWAY_ORIGIN: RAILWAY,
      QUACKBACK_SAAS_EDGE_SECRET: SECRET,
    } as NodeJS.ProcessEnv
    expect(
      requestWorkspaceHost(
        request(RAILWAY, {
          'x-quackback-customer-host': CUSTOMER,
          'x-quackback-customer-host-sig': sig,
        }),
        env
      )
    ).toBe(CUSTOMER)
  })

  it('ignores a signed header on a first-party workspace host', () => {
    const sig = signCustomerHost(SECRET, CUSTOMER)
    expect(
      requestWorkspaceHost(
        request(FIRST_PARTY, {
          'x-quackback-customer-host': CUSTOMER,
          'x-quackback-customer-host-sig': sig,
        }),
        {
          QUACKBACK_SAAS_RAILWAY_ORIGIN: RAILWAY,
          QUACKBACK_SAAS_EDGE_SECRET: SECRET,
        } as NodeJS.ProcessEnv
      )
    ).toBe(FIRST_PARTY)
  })

  it('ignores a header on the Railway origin when the secret is unset', () => {
    expect(
      requestWorkspaceHost(
        request(RAILWAY, {
          'x-quackback-customer-host': CUSTOMER,
          'x-quackback-customer-host-sig': signCustomerHost(SECRET, CUSTOMER),
        }),
        { QUACKBACK_SAAS_RAILWAY_ORIGIN: RAILWAY } as NodeJS.ProcessEnv
      )
    ).toBe(RAILWAY)
  })

  /*
   * Cross-check vector shared with the edge proxy that signs these headers:
   * both sides must produce exactly these digests from these inputs.
   */
  it('matches the shared signing vectors', () => {
    const secret = 'edge-ip-vector-secret'
    const host = 'feedback.example.com'
    expect(signCustomerHost(secret, host)).toBe(
      '8a538cb1c6461eec6841832c5070f220a2e1004e46b75606c0c29e5e2320125e'
    )
    expect(signEdgeClientIp(secret, host, '203.0.113.45', 1767225600)).toBe(
      'ca65233f4c87b76e0394a68b6b857855cd9295730a259e6cb6ab8fd8e06188d6'
    )
    expect(signEdgeClientIp(secret, host, '2001:db8::7', 1767225600)).toBe(
      'db4a788f3136b35657de9df407fd829b1101ff730d899a142e08685416e9e0ff'
    )
  })

  it('trusts the vector request at the app boundary', () => {
    const headers = new Headers({
      'x-quackback-customer-host': 'feedback.example.com',
      'x-quackback-customer-host-sig':
        '8a538cb1c6461eec6841832c5070f220a2e1004e46b75606c0c29e5e2320125e',
      'x-quackback-edge-client-ip': '203.0.113.45',
      'x-quackback-edge-client-ip-sig':
        '1767225600.ca65233f4c87b76e0394a68b6b857855cd9295730a259e6cb6ab8fd8e06188d6',
    })
    const env = {
      QUACKBACK_SAAS_RAILWAY_ORIGIN: RAILWAY,
      QUACKBACK_SAAS_EDGE_SECRET: ' edge-ip-vector-secret\n',
    } as NodeJS.ProcessEnv
    expect(edgeClientIp(headers, RAILWAY, env, 1767225600_000)).toBe('203.0.113.45')
    expect(edgeClientIp(headers, RAILWAY, env, 1767225901_000)).toBeNull()
    expect(edgeClientIp(headers, FIRST_PARTY, env, 1767225600_000)).toBeNull()
  })
})
