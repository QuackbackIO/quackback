/**
 * getNestedClaim + resolveSsoRole — pure helpers for IdP-attribute-
 * driven role assignment. Tested separately because the logic has
 * lots of branches and ID tokens have lots of shapes (dotted nested
 * objects, URL-shaped namespaced claims, arrays vs scalars, missing
 * values, etc.).
 */
import { describe, it, expect } from 'vitest'
import {
  getNestedClaim as serverGetNestedClaim,
  resolveSsoRole as serverResolveSsoRole,
  resolveSsoRoleMatch as serverResolveSsoRoleMatch,
} from '../resolve-sso-role'
import {
  getNestedClaim as previewGetNestedClaim,
  resolveSsoRole as previewResolveSsoRole,
  resolveSsoRoleMatch as previewResolveSsoRoleMatch,
} from '@/lib/shared/resolve-sso-role'
import type { ClaimRoleMapping } from '@/lib/server/db'

const getNestedClaim = serverGetNestedClaim
const resolveSsoRole = serverResolveSsoRole

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
  rules: Array<{ whenContains: string; role: 'admin' | 'member' | 'user' }>
): ClaimRoleMapping => ({
  claimPath: 'groups',
  rules,
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
      }
    )
    expect(role).toBe('admin')
  })

  it('returns null when no mapping is provided', () => {
    expect(resolveSsoRole({ groups: ['admin'] }, undefined)).toBeNull()
  })

  it('does not split CSV strings or match substrings', () => {
    expect(
      resolveSsoRole(
        { groups: 'platform-admins,analysts' },
        mapping([{ whenContains: 'analysts', role: 'member' }])
      )
    ).toBeNull()
    expect(
      resolveSsoRole(
        { groups: 'platform-admins' },
        mapping([{ whenContains: 'admin', role: 'admin' }])
      )
    ).toBeNull()
    expect(
      resolveSsoRole(
        { groups: ['platform-admins'] },
        mapping([{ whenContains: 'admin', role: 'admin' }])
      )
    ).toBeNull()
  })

  it('server and preview match literal dotted role claims identically', () => {
    const claims = {
      'realm_access.roles': ['nested-admin'],
      realm_access: { roles: ['dotted-member'] },
    }
    const mappingFor = (whenContains: string, role: 'admin' | 'member'): ClaimRoleMapping => ({
      claimPath: 'realm_access.roles',
      rules: [{ whenContains, role }],
    })
    const literal = mappingFor('nested-admin', 'admin')
    const nested = mappingFor('dotted-member', 'member')

    expect(serverGetNestedClaim(claims, 'realm_access.roles')).toEqual(['nested-admin'])
    expect(previewGetNestedClaim(claims, 'realm_access.roles')).toEqual(['nested-admin'])
    expect(serverResolveSsoRole(claims, literal)).toBe('admin')
    expect(previewResolveSsoRole(claims, literal)).toBe('admin')
    expect(serverResolveSsoRole(claims, nested)).toBeNull()
    expect(previewResolveSsoRole(claims, nested)).toBeNull()
    expect(serverResolveSsoRoleMatch(claims, literal)).toEqual({ role: 'admin', ruleIndex: 0 })
    expect(previewResolveSsoRoleMatch(claims, literal)).toEqual({ role: 'admin', ruleIndex: 0 })
  })
})
