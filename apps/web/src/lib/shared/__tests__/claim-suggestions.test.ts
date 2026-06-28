import { describe, it, expect } from 'vitest'
import { deriveClaimSuggestions } from '../claim-suggestions'

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
