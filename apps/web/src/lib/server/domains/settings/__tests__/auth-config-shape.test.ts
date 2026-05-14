import { describe, it, expect } from 'vitest'
import { DEFAULT_AUTH_CONFIG, type AuthConfig } from '../settings.types'

describe('AuthConfig.ssoOidc.autoProvisionRole', () => {
  it('accepts admin | member | user', () => {
    const sso: NonNullable<AuthConfig['ssoOidc']> = {
      enabled: false,
      discoveryUrl: '',
      clientId: '',
      autoCreateUsers: false,
      autoProvisionRole: 'admin',
    }
    expect(sso.autoProvisionRole).toBe('admin')
  })

  it('is omittable on DEFAULT_AUTH_CONFIG.ssoOidc (the field is optional)', () => {
    expect(DEFAULT_AUTH_CONFIG.ssoOidc).toBeUndefined()
  })
})
