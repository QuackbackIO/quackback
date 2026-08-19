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

/**
 * The sectioned `claim_mapping` column, read the same way by sign-in and by the
 * connection test. `attribute_mapping` was the role mapping under a misleading
 * name; it is now the `role` section here, so there is one place a claim is
 * turned into meaning rather than three.
 */
describe('claimMappingFor', () => {
  it('treats an absent column as "no configuration", not as an error', () => {
    const m = claimMappingFor(null)
    expect(m).toEqual({})
    expect(profileClaimFor(null, 'email')).toBeUndefined()
    expect(roleMappingFor(null)).toBeUndefined()
  })

  it('ignores a malformed value rather than letting it reach sign-in', () => {
    // A hand-edited row, or a shape from a future version. Sign-in must not
    // throw on it; the standard claims are a working fallback.
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
    // The editor sends '' for a cleared input; that must not become a lookup
    // for a claim literally named ''.
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
    // Minting a placeholder is one-way, so it is never the default.
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
    // Rules cannot be evaluated without a path, and a half-configured mapping
    // silently matching nothing is worse than no mapping at all.
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
