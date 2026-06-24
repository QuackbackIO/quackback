/**
 * registrationId allow-list: only the generated `oidc_` namespace and the two
 * legacy ids may be used. Blocks registering a provider under a built-in method
 * id (e.g. `credential`, `google`), which would short-circuit
 * `isAuthMethodAllowed` and bypass a disabled built-in method (Codex P2).
 */
import { describe, it, expect } from 'vitest'
import { isAllowedRegistrationId } from '../sso'

describe('isAllowedRegistrationId', () => {
  it('allows the generated oidc_ namespace', () => {
    expect(isAllowedRegistrationId('oidc_abc123')).toBe(true)
    expect(isAllowedRegistrationId('oidc_X9y8Z7')).toBe(true)
  })

  it('allows the two legacy ids', () => {
    expect(isAllowedRegistrationId('sso')).toBe(true)
    expect(isAllowedRegistrationId('custom-oidc')).toBe(true)
  })

  it('rejects built-in method ids that would bypass the auth-method gate', () => {
    for (const reserved of [
      'credential',
      'password',
      'magic-link',
      'magicLink',
      'google',
      'github',
    ]) {
      expect(isAllowedRegistrationId(reserved)).toBe(false)
    }
  })

  it('rejects an empty or malformed oidc id', () => {
    expect(isAllowedRegistrationId('')).toBe(false)
    expect(isAllowedRegistrationId('oidc_')).toBe(false)
    expect(isAllowedRegistrationId('oidc_bad!')).toBe(false)
    expect(isAllowedRegistrationId('OIDC')).toBe(false)
  })
})
