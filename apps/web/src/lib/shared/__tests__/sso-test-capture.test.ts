import { describe, it, expect } from 'vitest'
import { parseSsoTestCapture } from '../sso-test-capture'

describe('parseSsoTestCapture', () => {
  const valid = {
    registrationId: 'oidc_x',
    capturedAt: '2026-08-15T12:00:00.000Z',
    identity: {
      id: 'u1',
      email: 'jane@acme.com',
      name: 'Jane',
      sources: { id: 'idToken', email: 'idToken' },
    },
    claims: { email: 'jane@acme.com', groups: ['eng'] },
  }

  it('returns the fixture as stored, including email and groups', () => {
    const parsed = parseSsoTestCapture(valid)
    expect(parsed).toEqual(valid)
  })

  it('returns null for missing or malformed payloads', () => {
    expect(parseSsoTestCapture(null)).toBeNull()
    expect(parseSsoTestCapture({})).toBeNull()
    expect(parseSsoTestCapture({ ...valid, identity: { email: 'x' } })).toBeNull()
    expect(parseSsoTestCapture({ ...valid, claims: null })).toBeNull()
  })
})
