import { describe, expect, it } from 'vitest'
import { phoneCodeProblem } from '../test-customer'

describe('phoneCodeProblem', () => {
  const now = Date.parse('2026-10-04T12:00:00Z')

  it('asks for a scan when the page was opened without a code (or reloaded)', () => {
    expect(phoneCodeProblem({ hadCode: false, expiresAt: null, now })).toBe('missing')
  })

  it('calls a code past its time expired', () => {
    expect(phoneCodeProblem({ hadCode: true, expiresAt: now - 1, now })).toBe('expired')
  })

  it('calls a refused code that still had time already used', () => {
    expect(phoneCodeProblem({ hadCode: true, expiresAt: now + 60_000, now })).toBe('used')
    expect(phoneCodeProblem({ hadCode: true, expiresAt: null, now })).toBe('used')
  })
})
