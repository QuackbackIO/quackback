import { describe, expect, it } from 'vitest'
import {
  requestWorkspaceHost,
  signCustomerHost,
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
})
