/**
 * Branch-coverage tests for the OIDC error-explanation catalog.
 *
 * Each named case in `explainAuthorizeError` and `explainTokenError`
 * gets a recognizable keyword assertion + a description-passthrough
 * assertion. Default branches are covered explicitly because they're
 * what shows up when an IdP returns something we haven't seen before.
 */

import { describe, it, expect } from 'vitest'
import { explainAuthorizeError, explainTokenError } from '../oidc-error-explain'

describe('explainAuthorizeError', () => {
  it.each([
    ['invalid_request', /redirect_uri/i],
    ['unauthorized_client', /authorization_code|grant/i],
    ['access_denied', /denied|deny/i],
    ['unsupported_response_type', /response_type|authorization code flow/i],
    ['invalid_scope', /scope/i],
    ['server_error', /internal error|retry/i],
    ['temporarily_unavailable', /temporarily|retry/i],
  ])('returns a recognizable hint for %s', (code, pattern) => {
    const hint = explainAuthorizeError(code)
    expect(hint).toEqual(expect.any(String))
    expect(hint.length).toBeGreaterThan(0)
    expect(hint).toMatch(pattern)
  })

  it.each([
    'invalid_request',
    'unauthorized_client',
    'access_denied',
    'unsupported_response_type',
    'invalid_scope',
    'server_error',
    'temporarily_unavailable',
  ])('includes the IdP description text when provided for %s', (code) => {
    const description = `IdP-said-${code}-details-xyz`
    const hint = explainAuthorizeError(code, description)
    expect(hint).toContain(description)
  })

  it('returns a default hint mentioning the code for unknown errors', () => {
    const hint = explainAuthorizeError('totally_made_up_code')
    expect(hint).toEqual(expect.any(String))
    expect(hint.length).toBeGreaterThan(0)
    expect(hint).toMatch(/unrecognized/i)
    expect(hint).toContain('totally_made_up_code')
  })

  it('default branch still appends description text when present', () => {
    const hint = explainAuthorizeError('unknown_xyz', 'extra-detail-payload')
    expect(hint).toContain('unknown_xyz')
    expect(hint).toContain('extra-detail-payload')
  })
})

describe('explainTokenError', () => {
  it.each([
    ['invalid_grant', /PKCE|code|expired|redirect_uri/i],
    ['invalid_client', /client_secret|authentication|secret/i],
    ['invalid_request', /malformed|redirect_uri/i],
    ['unauthorized_client', /authorization_code|grant/i],
    ['unsupported_grant_type', /authorization_code|OIDC|OAuth/i],
  ])('returns a recognizable hint for %s', (code, pattern) => {
    const hint = explainTokenError(code, null, 400)
    expect(hint).toEqual(expect.any(String))
    expect(hint.length).toBeGreaterThan(0)
    expect(hint).toMatch(pattern)
  })

  it.each([
    'invalid_grant',
    'invalid_client',
    'invalid_request',
    'unauthorized_client',
    'unsupported_grant_type',
  ])('includes the description text when provided for %s', (code) => {
    const description = `idp-msg-for-${code}`
    const hint = explainTokenError(code, description, 400)
    expect(hint).toContain(description)
  })

  it('returns the HTTP status for the no-code default branch', () => {
    const hint = explainTokenError(undefined, null, 502)
    expect(hint).toEqual(expect.any(String))
    expect(hint.length).toBeGreaterThan(0)
    expect(hint).toMatch(/HTTP 502/)
  })

  it('no-code default branch still surfaces the description', () => {
    const hint = explainTokenError(undefined, 'gateway-timeout-detail', 504)
    expect(hint).toMatch(/HTTP 504/)
    expect(hint).toContain('gateway-timeout-detail')
  })

  it('unknown code branch mentions both the code and the HTTP status', () => {
    const hint = explainTokenError('mystery_code', null, 418)
    expect(hint).toMatch(/unrecognized/i)
    expect(hint).toContain('mystery_code')
    expect(hint).toMatch(/HTTP 418/)
  })

  it('unknown code branch still surfaces the description', () => {
    const hint = explainTokenError('mystery_code', 'teapot-said-no', 418)
    expect(hint).toContain('mystery_code')
    expect(hint).toContain('teapot-said-no')
    expect(hint).toMatch(/HTTP 418/)
  })
})
