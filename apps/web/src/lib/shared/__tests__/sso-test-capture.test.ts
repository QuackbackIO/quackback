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

  it('carries the avatar URL and its provenance when present', () => {
    const withImage = {
      ...valid,
      identity: {
        ...valid.identity,
        image: 'https://cdn.acme.com/jane.png',
        sources: { ...valid.identity.sources, image: 'userinfo' },
      },
    }
    expect(parseSsoTestCapture(withImage)).toEqual(withImage)
  })

  it('drops a non-string image', () => {
    const parsed = parseSsoTestCapture({
      ...valid,
      identity: { ...valid.identity, image: 42 },
    })
    expect(parsed?.identity.image).toBeUndefined()
  })

  it('returns null for missing or malformed payloads', () => {
    expect(parseSsoTestCapture(null)).toBeNull()
    expect(parseSsoTestCapture({})).toBeNull()
    expect(parseSsoTestCapture({ ...valid, identity: { email: 'x' } })).toBeNull()
    expect(parseSsoTestCapture({ ...valid, claims: null })).toBeNull()
  })
})
