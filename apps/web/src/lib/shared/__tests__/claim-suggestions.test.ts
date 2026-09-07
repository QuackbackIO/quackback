import { describe, it, expect } from 'vitest'
import {
  deriveAttributeClaimPaths,
  deriveClaimSuggestions,
  deriveIdentityClaimPaths,
  identityClaimHints,
} from '../claim-suggestions'

describe('deriveClaimSuggestions', () => {
  it('surfaces a top-level string[] claim as a path with its values', () => {
    const out = deriveClaimSuggestions({ groups: ['admins', 'devs'] })
    expect(out.paths).toEqual(['groups'])
    expect(out.valuesByPath).toEqual({ groups: ['admins', 'devs'] })
  })

  it('finds a nested array claim at depth 2 (Keycloak realm_access.roles)', () => {
    const out = deriveClaimSuggestions({ realm_access: { roles: ['admin'] } })
    expect(out.paths).toEqual(['realm_access.roles'])
    expect(out.valuesByPath['realm_access.roles']).toEqual(['admin'])
  })

  it('records a URL-shaped claim key literally, not split on slashes', () => {
    const out = deriveClaimSuggestions({ 'https://acme.com/roles': ['platform-admins'] })
    expect(out.paths).toEqual(['https://acme.com/roles'])
    expect(out.valuesByPath['https://acme.com/roles']).toEqual(['platform-admins'])
  })

  it('excludes standard identity claims and scalars', () => {
    const out = deriveClaimSuggestions({
      iss: 'https://idp',
      sub: 'u1',
      email: 'a@b.com',
      tid: '6045704a-f241-4b8d-99ba-4f91f4fc2e4b',
      ver: '2.0',
    })
    expect(out.paths).toEqual([])
  })

  it('skips empty arrays and dedupes + filters non-strings, preserving order', () => {
    const out = deriveClaimSuggestions({
      groups: ['a', 'a', 5 as unknown as string, 'b'],
      roles: [],
    })
    expect(out.paths).toEqual(['groups'])
    expect(out.valuesByPath.groups).toEqual(['a', 'b'])
  })
})

describe('deriveAttributeClaimPaths', () => {
  it('includes scalars and arrays, with a truncated value preview', () => {
    const out = deriveAttributeClaimPaths({
      department: 'Engineering',
      groups: ['admins', 'devs'],
    })
    expect(out.map((s) => s.path)).toEqual(['department', 'groups'])
    expect(out.find((s) => s.path === 'department')?.description).toBe('Engineering')
    expect(out.find((s) => s.path === 'groups')?.description).toBe('admins, devs')
  })

  it('walks nested objects to depth 2', () => {
    const out = deriveAttributeClaimPaths({ org: { costCenter: 'cc-1' } })
    expect(out.map((s) => s.path)).toEqual(['org.costCenter'])
    expect(out[0]?.description).toBe('cc-1')
  })

  it('records a URL-shaped key literally', () => {
    const out = deriveAttributeClaimPaths({ 'https://acme.com/plan': 'enterprise' })
    expect(out.map((s) => s.path)).toEqual(['https://acme.com/plan'])
  })

  it('excludes protocol claims and keeps profile claims', () => {
    const out = deriveAttributeClaimPaths({
      iss: 'https://idp',
      sub: 'u1',
      aud: 'cid',
      exp: 1,
      email: 'a@b.com',
      preferred_username: 'alice',
      name: 'Alice',
    })
    const paths = out.map((s) => s.path)
    expect(paths).toEqual(expect.arrayContaining(['email', 'preferred_username', 'name']))
    expect(paths).not.toContain('iss')
    expect(paths).not.toContain('sub')
    expect(paths).not.toContain('aud')
    expect(paths).not.toContain('exp')
  })
})

describe('deriveIdentityClaimPaths', () => {
  it('includes sub among identity suggestions even when attribute suggestions exclude it', () => {
    const claims = {
      iss: 'https://idp',
      sub: 'person-123',
      aud: 'cid',
      email: 'jane@example.test',
      groups: ['engineering'],
    }
    const identity = deriveIdentityClaimPaths(claims)
    const attributes = deriveAttributeClaimPaths(claims)
    expect(identity.map((s) => s.path)).toContain('sub')
    expect(identity.find((s) => s.path === 'sub')?.description).toBe('person-123')
    expect(attributes.map((s) => s.path)).not.toContain('sub')
  })

  it('includes sub when the capture omitted it', () => {
    const identity = deriveIdentityClaimPaths({ email: 'jane@example.test' })
    expect(identity.map((s) => s.path)).toContain('sub')
  })

  it('marks array candidates as unsuitable for identity and does not unwrap them', () => {
    const identity = deriveIdentityClaimPaths({
      sub: 'person-123',
      groups: ['engineering', 'admins'],
    })
    const groups = identity.find((s) => s.path === 'groups')
    expect(groups?.unsuitable).toBe(true)
    expect(groups?.description).toBe('engineering, admins')
    expect(identity.map((s) => s.path)).not.toContain('groups.0')
  })

  it('marks boolean and null identity leaves as unsuitable', () => {
    const identity = deriveIdentityClaimPaths({
      sub: 'person-123',
      email_verified: true,
      department: null,
      employee_id: 42,
    })
    expect(identity.find((s) => s.path === 'email_verified')?.unsuitable).toBe(true)
    expect(identity.find((s) => s.path === 'department')?.unsuitable).toBe(true)
    expect(identity.find((s) => s.path === 'employee_id')?.unsuitable).toBeUndefined()
  })

  it('offers entra aliases as suggestions without rewriting captured paths', () => {
    const identity = deriveIdentityClaimPaths({ sub: 's-1', email: 'a@b.test' }, { kind: 'entra' })
    const paths = identity.map((s) => s.path)
    expect(paths).toEqual(expect.arrayContaining(['sub', 'oid', 'upn', 'email']))
    expect(identityClaimHints('entra', 'id')).toEqual(['oid', 'sub'])
    expect(identityClaimHints('entra', 'email')).toEqual(['email', 'upn', 'preferred_username'])
  })
})
