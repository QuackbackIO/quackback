import { describe, it, expect, vi } from 'vitest'
import { resolveIdentity } from '../resolve-identity'
import {
  WORLD_A,
  WORLD_B,
  WORLD_C,
  WORLD_NO_ID_TOKEN,
  WORLD_SUBJECT_MISMATCH,
  WORLD_UNRESOLVABLE,
  fakeJwt,
  userinfoFetcherFor,
  type IdpWorld,
} from './_idp-worlds'

function resolveWorld(world: IdpWorld, over: Record<string, unknown> = {}) {
  return resolveIdentity({
    tokens: world.tokens,
    fetchUserInfo: userinfoFetcherFor(world),
    ...over,
  })
}

describe('resolveIdentity — the worlds', () => {
  it.each([WORLD_A, WORLD_B, WORLD_C, WORLD_NO_ID_TOKEN])('resolves $name', async (world) => {
    const result = await resolveWorld(world, {
      mapping: world === WORLD_NO_ID_TOKEN ? { sources: ['accessTokenJwt'] } : undefined,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.id).toBe(world.expect.id)
    expect(result.identity.email ?? null).toBe(world.expect.email)
    expect(result.identity.name ?? null).toBe(world.expect.name)
  })

  it('records which source supplied each field', async () => {
    const result = await resolveWorld(WORLD_B)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.sources).toMatchObject(WORLD_B.expect.sources!)
  })

  it('returns every raw claim alongside the mapped fields', async () => {
    const result = await resolveWorld(WORLD_A)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.claims).toMatchObject({ sub: WORLD_A.expect.id, name: 'World A' })
  })
})

describe('resolveIdentity — visiting every configured source', () => {
  it('still fetches userinfo when the ID token is complete, so extra claims merge', async () => {
    const fetchUserInfo = vi.fn(async () => ({
      sub: WORLD_A.expect.id,
      groups: ['staff'],
      department: 'Eng',
    }))
    const result = await resolveIdentity({ tokens: WORLD_A.tokens, fetchUserInfo })
    expect(result.ok).toBe(true)
    expect(fetchUserInfo).toHaveBeenCalledTimes(1)
    if (!result.ok) return
    expect(result.identity.email).toBe(WORLD_A.expect.email)
    expect(result.identity.sources.email).toBe('idToken')
    expect(result.identity.claims.groups).toEqual(['staff'])
    expect(result.identity.claims.department).toBe('Eng')
  })

  it('DOES fetch userinfo when a required field is missing', async () => {
    const fetchUserInfo = vi.fn(async () => WORLD_B.userinfo)
    await resolveIdentity({ tokens: WORLD_B.tokens, fetchUserInfo })
    expect(fetchUserInfo).toHaveBeenCalledTimes(1)
  })

  it('fetches userinfo only once even when several fields are missing', async () => {
    const fetchUserInfo = vi.fn(async () => ({ sub: 'x', email: 'e@x.com', name: 'N' }))
    await resolveIdentity({ tokens: { idToken: fakeJwt({ sub: 'x' }) }, fetchUserInfo })
    expect(fetchUserInfo).toHaveBeenCalledTimes(1)
  })
})

describe('resolveIdentity — subject consistency (OIDC Core 5.3.2)', () => {
  it('fails when userinfo reports a different subject, under enforcement', async () => {
    const result = await resolveWorld(WORLD_SUBJECT_MISMATCH, { subjectMismatch: 'enforce' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('subject_mismatch')
  })

  it('does not mix the two sources under enforcement', async () => {
    const result = await resolveWorld(WORLD_SUBJECT_MISMATCH, { subjectMismatch: 'enforce' })
    expect(JSON.stringify(result)).not.toContain('attacker@example.com')
  })

  it('never mixes the two sources while observing either', async () => {
    const result = await resolveWorld(WORLD_SUBJECT_MISMATCH)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.id).toBe('a-different-subject')
    expect(result.identity.sources.id).toBe('userinfo')
  })

  it('keeps a complete ID-token identity when userinfo disagrees, and does not merge it', async () => {
    const result = await resolveIdentity({
      tokens: {
        idToken: fakeJwt({
          sub: 'from-token',
          email: 'token@x.com',
          name: 'From Token',
        }),
        accessToken: 'at',
      },
      fetchUserInfo: async () => ({
        sub: 'from-userinfo',
        email: 'attacker@example.com',
        name: 'Someone Else',
        groups: ['injected'],
      }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.id).toBe('from-token')
    expect(result.identity.email).toBe('token@x.com')
    expect(result.identity.name).toBe('From Token')
    expect(result.identity.sources.id).toBe('idToken')
    expect(result.identity.warnings).toContain('subject_mismatch')
    expect(result.identity.claims).not.toHaveProperty('groups')
    expect(JSON.stringify(result)).not.toContain('attacker@example.com')
  })

  it('does NOT apply the rule to the access token, whose subject may differ', async () => {
    const result = await resolveIdentity({
      tokens: {
        idToken: fakeJwt({ sub: 'client-facing-sub', email: 'e@x.com', name: 'N' }),
        accessToken: fakeJwt({ sub: 'resource-facing-sub' }),
      },
      fetchUserInfo: async () => null,
      mapping: { sources: ['idToken', 'accessTokenJwt'] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.id).toBe('client-facing-sub')
  })
})

describe('resolveIdentity — failure', () => {
  it('reports no_identity when nothing yields a subject', async () => {
    const result = await resolveWorld(WORLD_UNRESOLVABLE)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no_identity')
  })

  it('survives an unreachable userinfo endpoint', async () => {
    const result = await resolveIdentity({
      tokens: { idToken: fakeJwt({ sub: 's', email: 'e@x.com', name: 'N' }) },
      fetchUserInfo: async () => {
        throw new Error('network down')
      },
    })
    expect(result.ok).toBe(true)
  })
})

describe('resolveIdentity — claim mapping', () => {
  it('reads CharacterID-style PascalCase claims from a configured path', async () => {
    const result = await resolveIdentity({
      tokens: { accessToken: fakeJwt({ CharacterID: 42, CharacterName: 'Pilot' }) },
      fetchUserInfo: async () => null,
      mapping: { sources: ['accessTokenJwt'], idClaim: 'CharacterID', nameClaim: 'CharacterName' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.id).toBe('42')
    expect(result.identity.name).toBe('Pilot')
  })

  it('prefers an exact key match before treating dots as a path', async () => {
    const result = await resolveIdentity({
      tokens: {
        idToken: fakeJwt({ sub: 's', 'https://acme.com/email': 'ns@x.com', name: 'N' }),
      },
      fetchUserInfo: async () => null,
      mapping: { emailClaim: 'https://acme.com/email' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.email).toBe('ns@x.com')
  })

  it('resolves a genuinely nested claim by dotted path', async () => {
    const result = await resolveIdentity({
      tokens: { idToken: fakeJwt({ sub: 's', contact: { email: 'deep@x.com' }, name: 'N' }) },
      fetchUserInfo: async () => null,
      mapping: { emailClaim: 'contact.email' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.email).toBe('deep@x.com')
  })
})

describe('resolveIdentity — emailVerified provenance', () => {
  it('takes the verified flag from the source that supplied the address', async () => {
    const result = await resolveIdentity({
      tokens: { idToken: fakeJwt({ sub: 's', email_verified: true }) },
      fetchUserInfo: async () => ({ sub: 's', email: 'from-userinfo@x.com', name: 'N' }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.email).toBe('from-userinfo@x.com')
    expect(result.identity.emailVerified).toBe(false)
  })

  it('coerces strictly, so a stringified "false" is not verified', async () => {
    const result = await resolveIdentity({
      tokens: {
        idToken: fakeJwt({ sub: 's', email: 'e@x.com', name: 'N', email_verified: 'false' }),
      },
      fetchUserInfo: async () => null,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.emailVerified).toBe(false)
  })
})

describe('resolveIdentity — account identifier compatibility', () => {
  it('falls back to `id` for a userinfo document with no `sub`', async () => {
    const result = await resolveIdentity({
      tokens: {},
      fetchUserInfo: async () => ({ id: 'legacy-account-id', email: 'e@x.com', name: 'N' }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.id).toBe('legacy-account-id')
  })

  it('prefers `sub` when userinfo carries both', async () => {
    const result = await resolveIdentity({
      tokens: {},
      fetchUserInfo: async () => ({ sub: 'the-sub', id: 'the-id', email: 'e@x.com', name: 'N' }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.id).toBe('the-sub')
  })

  it('does NOT fall back to `id` in an ID token', async () => {
    const result = await resolveIdentity({
      tokens: { idToken: fakeJwt({ id: 'not-a-subject', email: 'e@x.com', name: 'N' }) },
      fetchUserInfo: async () => null,
    })
    expect(result.ok).toBe(false)
  })

  it('compares the subject guard against the same fallback', async () => {
    const result = await resolveIdentity({
      tokens: { idToken: fakeJwt({ sub: 'from-token' }) },
      fetchUserInfo: async () => ({ id: 'different', email: 'e@x.com', name: 'N' }),
      subjectMismatch: 'enforce',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('subject_mismatch')
  })

  it('honours an explicit idClaim over the fallback', async () => {
    const result = await resolveIdentity({
      tokens: {},
      fetchUserInfo: async () => ({ sub: 'ignored', CharacterID: 42, name: 'N' }),
      mapping: { idClaim: 'CharacterID' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.id).toBe('42')
  })
})

describe('resolveIdentity — subject mismatch, observe vs enforce', () => {
  const mismatched = {
    tokens: { idToken: fakeJwt({ sub: 'from-token' }), accessToken: 'at' },
    fetchUserInfo: async () => ({ sub: 'from-userinfo', email: 'e@x.com', name: 'N' }),
  }

  it('observes by default: incomplete identity still lets userinfo win wholesale', async () => {
    const result = await resolveIdentity(mismatched)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.id).toBe('from-userinfo')
    expect(result.identity.email).toBe('e@x.com')
    expect(result.identity.warnings).toContain('subject_mismatch')
  })

  it('enforces when asked, refusing to mix the two', async () => {
    const result = await resolveIdentity({ ...mismatched, subjectMismatch: 'enforce' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('subject_mismatch')
  })

  it('reports no warning when the subjects agree', async () => {
    const result = await resolveIdentity({
      tokens: { idToken: fakeJwt({ sub: 'same' }), accessToken: 'at' },
      fetchUserInfo: async () => ({ sub: 'same', email: 'e@x.com', name: 'N' }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.warnings ?? []).not.toContain('subject_mismatch')
  })
})
