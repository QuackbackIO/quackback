import { describe, it, expect } from 'vitest'
import {
  DEFAULT_IDENTITY_SOURCES,
  claimMappingFor,
  profileClaimFor,
  roleMappingFor,
  allowsMissingEmail,
  getClaimByPath,
  type IdentityProviderClaimMapping,
} from '../oidc-claim-mapping'

describe('claimMappingFor', () => {
  it('treats an absent column as "no configuration", not as an error', () => {
    const m = claimMappingFor(null)
    expect(m).toEqual({})
    expect(profileClaimFor(null, 'email')).toBeUndefined()
    expect(roleMappingFor(null)).toBeUndefined()
  })

  it('ignores a malformed value rather than letting it reach sign-in', () => {
    expect(claimMappingFor('not an object' as unknown)).toEqual({})
    expect(claimMappingFor(42 as unknown)).toEqual({})
    expect(claimMappingFor([] as unknown)).toEqual({})
  })
})

describe('profileClaimFor', () => {
  it('returns the configured claim path for a field', () => {
    const m: IdentityProviderClaimMapping = {
      profile: { claims: { email: 'https://acme.com/mail', name: 'preferred_username' } },
    }
    expect(profileClaimFor(m, 'email')).toBe('https://acme.com/mail')
    expect(profileClaimFor(m, 'name')).toBe('preferred_username')
  })

  it('returns undefined for a field left unset so the standard claim is used', () => {
    const m: IdentityProviderClaimMapping = { profile: { claims: { email: 'mail' } } }
    expect(profileClaimFor(m, 'name')).toBeUndefined()
    expect(profileClaimFor(m, 'id')).toBeUndefined()
  })

  it('treats an empty or whitespace path as unset', () => {
    const m: IdentityProviderClaimMapping = { profile: { claims: { email: '   ', name: '' } } }
    expect(profileClaimFor(m, 'email')).toBeUndefined()
    expect(profileClaimFor(m, 'name')).toBeUndefined()
  })
})

describe('identity sources', () => {
  it('defaults to the id token then userinfo, with the access token opt-in', () => {
    expect(DEFAULT_IDENTITY_SOURCES).toEqual(['idToken', 'userinfo'])
    expect(claimMappingFor({}).profile?.sources).toBeUndefined()
  })

  it('keeps a configured order and drops anything unrecognised', () => {
    const m = claimMappingFor({
      profile: { sources: ['accessTokenJwt', 'idToken', 'telepathy'] },
    })
    expect(m.profile?.sources).toEqual(['accessTokenJwt', 'idToken'])
  })
})

describe('allowsMissingEmail', () => {
  it('is off unless the admin turned it on', () => {
    expect(allowsMissingEmail(null)).toBe(false)
    expect(allowsMissingEmail({})).toBe(false)
    expect(allowsMissingEmail({ profile: {} })).toBe(false)
  })

  it('is on only for a literal true', () => {
    expect(allowsMissingEmail({ profile: { allowMissingEmail: true } })).toBe(true)
    expect(
      allowsMissingEmail({ profile: { allowMissingEmail: 'yes' as unknown as boolean } })
    ).toBe(false)
  })
})

describe('roleMappingFor', () => {
  it('reads the role section', () => {
    const m: IdentityProviderClaimMapping = {
      role: {
        claimPath: 'realm_access.roles',
        rules: [{ whenContains: 'staff', role: 'member' }],
        syncOnEverySignIn: true,
      },
    }
    const role = roleMappingFor(m)
    expect(role?.claimPath).toBe('realm_access.roles')
    expect(role?.rules).toHaveLength(1)
    expect(role?.syncOnEverySignIn).toBe(true)
  })

  it('drops a role section with no usable claim path', () => {
    expect(roleMappingFor({ role: { claimPath: '', rules: [] } })).toBeUndefined()
  })

  it('drops rules that name a role outside the known set', () => {
    const role = roleMappingFor({
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'a', role: 'admin' },
          { whenContains: 'b', role: 'superuser' as unknown as 'admin' },
        ],
      },
    })
    expect(role?.rules).toEqual([{ whenContains: 'a', role: 'admin' }])
  })
})

describe('getClaimByPath', () => {
  it('prefers an exact key match before treating dots as a path', () => {
    const claims = { 'https://acme.com/email': 'ns@x.com', contact: { email: 'nested@x.com' } }
    expect(getClaimByPath(claims, 'https://acme.com/email')).toBe('ns@x.com')
    expect(getClaimByPath(claims, 'contact.email')).toBe('nested@x.com')
  })
})

describe('attributes section', () => {
  it('reads the map, override, and sync-on-sign-in flags', () => {
    const m = claimMappingFor({
      attributes: {
        map: [{ claimPath: 'department', attributeKey: 'dept' }],
        overrideExisting: true,
        syncOnSignIn: true,
      },
    })
    expect(m.attributes?.map).toEqual([{ claimPath: 'department', attributeKey: 'dept' }])
    expect(m.attributes?.overrideExisting).toBe(true)
    expect(m.attributes?.syncOnSignIn).toBe(true)
  })
})
