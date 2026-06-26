/**
 * getNestedClaim + resolveSsoRole — pure helpers for IdP-attribute-
 * driven role assignment. Tested separately because the logic has
 * lots of branches and ID tokens have lots of shapes (dotted nested
 * objects, URL-shaped namespaced claims, arrays vs scalars, missing
 * values, etc.).
 */
import { describe, it, expect } from 'vitest'
import { getNestedClaim, resolveSsoRole } from '../resolve-sso-role'
import type { AuthConfig } from '@/lib/server/domains/settings/settings.types'

describe('getNestedClaim', () => {
  it('reads a dotted path', () => {
    expect(getNestedClaim({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42)
  })

  it('reads a single-segment key', () => {
    expect(getNestedClaim({ groups: ['admins'] }, 'groups')).toEqual(['admins'])
  })

  it('reads a URL-shaped namespaced claim path literally', () => {
    const claims = { 'https://acme.com/roles': ['platform-admins'] }
    expect(getNestedClaim(claims, 'https://acme.com/roles')).toEqual(['platform-admins'])
  })

  it('reads a Keycloak-style realm_access.roles dotted path', () => {
    const claims = { realm_access: { roles: ['admin', 'developer'] } }
    expect(getNestedClaim(claims, 'realm_access.roles')).toEqual(['admin', 'developer'])
  })

  it('returns undefined for missing paths', () => {
    expect(getNestedClaim({ a: 1 }, 'b')).toBeUndefined()
    expect(getNestedClaim({ a: { b: 1 } }, 'a.c')).toBeUndefined()
    expect(getNestedClaim({ a: null }, 'a.b')).toBeUndefined()
  })

  it('returns undefined for non-object intermediate values', () => {
    expect(getNestedClaim({ a: 5 }, 'a.b')).toBeUndefined()
    expect(getNestedClaim({ a: 'string' }, 'a.b')).toBeUndefined()
  })
})

const mapping = (
  rules: Array<{ whenContains: string; role: 'admin' | 'member' | 'user' }>,
  defaultRole: 'admin' | 'member' | 'user' = 'member'
): NonNullable<AuthConfig['ssoOidc']>['attributeMapping'] => ({
  claimPath: 'groups',
  rules,
  defaultRole,
})

describe('resolveSsoRole', () => {
  it('returns the first-match-wins role for an array claim', () => {
    const role = resolveSsoRole(
      { groups: ['analysts', 'platform-admins'] },
      mapping([
        { whenContains: 'platform-admins', role: 'admin' },
        { whenContains: 'analysts', role: 'member' },
      ])
    )
    expect(role).toBe('admin')
  })

  it('matches a scalar claim with whenContains equality', () => {
    const role = resolveSsoRole(
      { groups: 'platform-admin' },
      mapping([{ whenContains: 'platform-admin', role: 'admin' }])
    )
    expect(role).toBe('admin')
  })

  it('returns null when no rule matches (caller supplies the default)', () => {
    const role = resolveSsoRole(
      { groups: ['support'] },
      mapping([{ whenContains: 'admins', role: 'admin' }])
    )
    expect(role).toBeNull()
  })

  it('returns null when the claim is missing', () => {
    const role = resolveSsoRole({}, mapping([{ whenContains: 'admins', role: 'admin' }]))
    expect(role).toBeNull()
  })

  it('is case-insensitive when matching', () => {
    const role = resolveSsoRole(
      { groups: ['Platform-Admins'] },
      mapping([{ whenContains: 'platform-admins', role: 'admin' }])
    )
    expect(role).toBe('admin')
  })

  it('handles URL-shaped claim paths', () => {
    const role = resolveSsoRole(
      { 'https://acme.com/roles': ['platform-admins'] },
      {
        claimPath: 'https://acme.com/roles',
        rules: [{ whenContains: 'platform-admins', role: 'admin' }],
        defaultRole: 'member',
      }
    )
    expect(role).toBe('admin')
  })

  it('returns null when no mapping is provided', () => {
    expect(resolveSsoRole({ groups: ['admin'] }, undefined)).toBeNull()
  })
})
