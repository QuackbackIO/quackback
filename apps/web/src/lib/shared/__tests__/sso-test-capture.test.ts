import { describe, it, expect } from 'vitest'
import {
  captureIdentityCaption,
  captureSuggestionClaims,
  isReplayableCapture,
  parseSsoTestCapture,
} from '../sso-test-capture'

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
    expect(parsed?.identity?.image).toBeUndefined()
  })

  it('returns null for missing or malformed payloads', () => {
    expect(parseSsoTestCapture(null)).toBeNull()
    expect(parseSsoTestCapture({})).toBeNull()
    expect(parseSsoTestCapture({ ...valid, identity: { email: 'x' } })).toBeNull()
    expect(parseSsoTestCapture({ ...valid, claims: null })).toBeNull()
  })

  it('legacy capture remains inspectable but is not exact replay', () => {
    const parsed = parseSsoTestCapture(valid)
    expect(parsed).not.toBeNull()
    expect(isReplayableCapture(parsed!)).toBe(false)
    expect(captureIdentityCaption(parsed!)).toBe('jane@acme.com')
  })

  it('parses a V2 capture with optional identity', () => {
    const v2 = {
      version: 2,
      registrationId: 'oidc_x',
      capturedAt: '2026-09-07T12:00:00.000Z',
      detailsChangedAtAtStart: null,
      outcome: 'mapping_failed',
      claims: { sub: 'u1', upn: 'jane@acme.com' },
      replay: {
        sources: [
          { source: 'idToken', claims: { sub: 'u1' } },
          { source: 'userinfo', unavailable: 'fetch_failed' },
        ],
      },
    }
    const parsed = parseSsoTestCapture(v2)
    expect(parsed).toMatchObject({ version: 2, outcome: 'mapping_failed' })
    expect(parsed && 'identity' in parsed ? parsed.identity : undefined).toBeUndefined()
    expect(isReplayableCapture(parsed!)).toBe(true)
    expect(captureIdentityCaption(parsed!)).toBe('Not supplied')
  })

  it('rejects a V2 capture with an unknown source', () => {
    expect(
      parseSsoTestCapture({
        version: 2,
        registrationId: 'oidc_x',
        capturedAt: '2026-09-07T12:00:00.000Z',
        detailsChangedAtAtStart: null,
        outcome: 'success',
        claims: {},
        replay: { sources: [{ source: 'scim', claims: {} }] },
      })
    ).toBeNull()
  })
})

describe('captureSuggestionClaims', () => {
  it('includes later-source claims the binder omitted from capture.claims', () => {
    const claims = captureSuggestionClaims({
      version: 2,
      registrationId: 'oidc_x',
      capturedAt: '2026-09-07T12:00:00.000Z',
      detailsChangedAtAtStart: null,
      outcome: 'success',
      claims: { sub: 'u1', email: 'a@x.com', name: 'A' },
      replay: {
        sources: [
          { source: 'idToken', claims: { sub: 'u1', email: 'a@x.com', name: 'A' } },
          { source: 'userinfo', claims: { sub: 'u1', groups: ['engineering'] } },
        ],
      },
    })
    expect(claims.groups).toEqual(['engineering'])
    expect(claims.email).toBe('a@x.com')
  })

  it('omits discarded mismatched userinfo from suggestion candidates', () => {
    const claims = captureSuggestionClaims({
      version: 2,
      registrationId: 'oidc_x',
      capturedAt: '2026-09-07T12:00:00.000Z',
      detailsChangedAtAtStart: null,
      outcome: 'success',
      claims: { sub: 'from-token', email: 'a@x.com', name: 'A', groups: ['eng'] },
      replay: {
        sources: [
          {
            source: 'idToken',
            claims: { sub: 'from-token', email: 'a@x.com', name: 'A', groups: ['eng'] },
          },
          {
            source: 'userinfo',
            claims: { sub: 'other-subject', groups: ['ops'], extra: 'only-userinfo' },
          },
        ],
      },
    })
    expect(claims.groups).toEqual(['eng'])
    expect(claims.extra).toBeUndefined()
  })
})
