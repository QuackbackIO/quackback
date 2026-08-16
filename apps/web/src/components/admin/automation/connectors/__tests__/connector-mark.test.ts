import { describe, expect, it } from 'vitest'
import { connectorInitials, connectorMarkTone } from '../connector-mark'

describe('connectorInitials', () => {
  it('uses the first letter of the first two words', () => {
    expect(connectorInitials('Acme Billing')).toBe('AB')
    expect(connectorInitials('Ops Runbook')).toBe('OR')
  })

  it('falls back to the first two characters of a single word', () => {
    expect(connectorInitials('Shipping')).toBe('SH')
  })
})

describe('connectorMarkTone', () => {
  it('is stable for the same name', () => {
    expect(connectorMarkTone('Acme Billing')).toEqual(connectorMarkTone('Acme Billing'))
  })

  it('varies across names', () => {
    expect(connectorMarkTone('Acme Billing')).not.toEqual(connectorMarkTone('Shipping Desk'))
  })
})
