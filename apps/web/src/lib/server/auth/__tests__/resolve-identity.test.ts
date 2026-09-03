import { describe, it, expect, vi } from 'vitest'
import { resolveIdentity, pickAvatarUrl } from '../resolve-identity'
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
      // The EVE-shaped world needs its opt-in source; everything else is default.
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
    // Better-Auth spreads the resolved object into mapProfileToUser, which is
    // how locale and avatar populate. Dropping the raw claims would regress
    // both on every provider, compliant ones included.
    const result = await resolveWorld(WORLD_A)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.claims).toMatchObject({ sub: WORLD_A.expect.id, name: 'World A' })
  })
})

describe('resolveIdentity — the fast path', () => {
  it('does not touch userinfo when the ID token is complete', async () => {
    // Compliant providers must take no added latency from the cascade.
    const fetchUserInfo = vi.fn(async () => WORLD_A.userinfo)
    const result = await resolveIdentity({ tokens: WORLD_A.tokens, fetchUserInfo })
    expect(result.ok).toBe(true)
    expect(fetchUserInfo).not.toHaveBeenCalled()
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

  it('with wantImage, keeps going to userinfo for a `picture` the ID token lacks', async () => {
    // The reported bug: id + email + name are all in the ID token, so the fast
    // path used to stop before userinfo — where this provider's only `picture`
    // lives — and the avatar was silently dropped.
    const fetchUserInfo = vi.fn(async () => ({
      sub: 'x',
      picture: 'https://cdn.example.com/x.png',
    }))
    const result = await resolveIdentity({
      tokens: { idToken: fakeJwt({ sub: 'x', email: 'e@x.com', name: 'N' }) },
      fetchUserInfo,
      wantImage: true,
    })
    expect(fetchUserInfo).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.image).toBe('https://cdn.example.com/x.png')
    expect(result.identity.sources.image).toBe('userinfo')
    expect(result.identity.claims.picture).toBe('https://cdn.example.com/x.png')
  })

  it('with wantImage, still short-circuits once the picture is in the ID token', async () => {
    const fetchUserInfo = vi.fn(async () => ({ sub: 'x', picture: 'https://cdn/other.png' }))
    const result = await resolveIdentity({
      tokens: {
        idToken: fakeJwt({
          sub: 'x',
          email: 'e@x.com',
          name: 'N',
          picture: 'https://cdn/id.png',
        }),
      },
      fetchUserInfo,
      wantImage: true,
    })
    expect(fetchUserInfo).not.toHaveBeenCalled()
    if (!result.ok) throw new Error('expected ok')
    expect(result.identity.image).toBe('https://cdn/id.png')
    expect(result.identity.sources.image).toBe('idToken')
  })

  it('without wantImage (the default), a picture at userinfo is never fetched for', async () => {
    const fetchUserInfo = vi.fn(async () => ({ sub: 'x', picture: 'https://cdn/x.png' }))
    const result = await resolveIdentity({
      tokens: { idToken: fakeJwt({ sub: 'x', email: 'e@x.com', name: 'N' }) },
      fetchUserInfo,
    })
    expect(fetchUserInfo).not.toHaveBeenCalled()
    if (!result.ok) throw new Error('expected ok')
    expect(result.identity.image).toBeUndefined()
    expect('image' in result.identity).toBe(false)
  })

  it('with wantImage but no picture anywhere, resolves without an image', async () => {
    const fetchUserInfo = vi.fn(async () => ({ sub: 'x' }))
    const result = await resolveIdentity({
      tokens: { idToken: fakeJwt({ sub: 'x', email: 'e@x.com', name: 'N' }) },
      fetchUserInfo,
      wantImage: true,
    })
    // One fetch (looking for the picture), then gives up cleanly.
    expect(fetchUserInfo).toHaveBeenCalledTimes(1)
    if (!result.ok) throw new Error('expected ok')
    expect(result.identity.image).toBeUndefined()
  })

  it('with wantImage, rejects a non-http(s) picture claim', async () => {
    const result = await resolveIdentity({
      tokens: {
        idToken: fakeJwt({
          sub: 'x',
          email: 'e@x.com',
          name: 'N',
          picture: 'data:image/png;base64,iVBORw0KGgo=',
        }),
      },
      fetchUserInfo: async () => null,
      wantImage: true,
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.identity.image).toBeUndefined()
  })

  it('with wantImage + imageClaim, reads a non-standard avatar claim', async () => {
    const result = await resolveIdentity({
      tokens: {
        idToken: fakeJwt({
          sub: 'x',
          email: 'e@x.com',
          name: 'N',
          avatar_url: 'https://cdn/a.png',
        }),
      },
      fetchUserInfo: async () => null,
      wantImage: true,
      mapping: { imageClaim: 'avatar_url' },
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.identity.image).toBe('https://cdn/a.png')
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
    // Quietly preferring one source would let a token-confused IdP bind an
    // attacker-controlled address, which trusted-provider linking matches on.
    const result = await resolveWorld(WORLD_SUBJECT_MISMATCH, { subjectMismatch: 'enforce' })
    expect(JSON.stringify(result)).not.toContain('attacker@example.com')
  })

  it('never mixes the two sources while observing either', async () => {
    // Observing preserves today's behaviour, which is userinfo winning
    // WHOLESALE — so the ID token's subject must not survive alongside the
    // userinfo address. A blend of the two is the one outcome never allowed.
    const result = await resolveWorld(WORLD_SUBJECT_MISMATCH)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.id).toBe('a-different-subject')
    expect(result.identity.sources.id).toBe('userinfo')
  })

  it('does NOT apply the rule to the access token, whose subject may differ', async () => {
    // 5.3.2 is scoped to the userinfo response. An access token is
    // audience-scoped and pairwise subjects legitimately differ, so enforcing
    // equality there would hard-fail every user on such a provider.
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
    // The ID token already had everything, so the outage is irrelevant.
    expect(result.ok).toBe(true)
  })
})

describe('resolveIdentity — claim mapping', () => {
  it('reads non-standard claim names from a configured path', async () => {
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
    // Namespaced claims contain dots that are not separators.
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
    // A verified flag from the ID token must not vouch for a userinfo address.
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

/**
 * Account-identifier compatibility.
 *
 * The account row's identifier is written from whatever the resolver returns as
 * `id`, and lookup matches on it first with an email fallback. If an upgrade
 * changes which claim supplies it, the lookup misses, the email fallback finds
 * the user, and a SECOND account row appears — or, with no email, the user
 * forks. Neither is undone by rolling the image back, and there is no
 * uniqueness constraint that would make it fail loudly instead.
 *
 * So the resolver must reproduce the library's own derivation exactly for every
 * provider that works today.
 */
describe('resolveIdentity — account identifier compatibility', () => {
  it('falls back to `id` for a userinfo document with no `sub`', async () => {
    // The library does `userInfo.sub ?? userInfo.id`. Resolving only `sub`
    // would re-key every account on a provider whose userinfo omits it.
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
    // The library keys the id_token path on `sub` alone, so honouring `id`
    // here would invent an identifier it never used.
    const result = await resolveIdentity({
      tokens: { idToken: fakeJwt({ id: 'not-a-subject', email: 'e@x.com', name: 'N' }) },
      fetchUserInfo: async () => null,
    })
    expect(result.ok).toBe(false)
  })

  it('compares the subject guard against the same fallback', async () => {
    // A userinfo doc identified by `id` rather than `sub` must still be checked
    // for agreement, or the guard could be sidestepped by omitting `sub`.
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

/**
 * Observe-then-enforce on the subject guard.
 *
 * The guard is a breaking change for exactly the population the cascade
 * rescues: a provider whose userinfo subject differs from its ID token's works
 * TODAY, because the existing path discards the ID token and takes userinfo
 * wholesale. Enforcing on the same release that ships the cascade would turn
 * that into a total, simultaneous sign-in outage on an upgrade nobody chose,
 * delivered as an opaque error redirect, with no telemetry to size it first.
 *
 * So the default observes: behave as today and report the discrepancy. A later
 * release flips to enforcing once the real rate is known.
 */
describe('resolveIdentity — subject mismatch, observe vs enforce', () => {
  const mismatched = {
    tokens: { idToken: fakeJwt({ sub: 'from-token' }), accessToken: 'at' },
    fetchUserInfo: async () => ({ sub: 'from-userinfo', email: 'e@x.com', name: 'N' }),
  }

  it('observes by default: resolves as today and flags it', async () => {
    const result = await resolveIdentity(mismatched)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Today's behaviour is userinfo winning wholesale, so preserving it means
    // the userinfo subject is what keys the account.
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

  it('clears an ID-token image alongside the rest on a subject mismatch', async () => {
    const result = await resolveIdentity({
      tokens: {
        idToken: fakeJwt({ sub: 'from-token', picture: 'https://cdn/token.png' }),
        accessToken: 'at',
      },
      fetchUserInfo: async () => ({
        sub: 'from-userinfo',
        email: 'e@x.com',
        name: 'N',
        picture: 'https://cdn/userinfo.png',
      }),
      wantImage: true,
    })
    if (!result.ok) throw new Error('expected ok')
    // The token's image must not survive when the token's subject didn't.
    expect(result.identity.image).toBe('https://cdn/userinfo.png')
    expect(result.identity.sources.image).toBe('userinfo')
  })
})

describe('pickAvatarUrl — the OIDC `picture` claim', () => {
  it('takes an absolute https URL', () => {
    expect(pickAvatarUrl({ picture: 'https://cdn.example.com/u/42.png' })).toBe(
      'https://cdn.example.com/u/42.png'
    )
  })

  it('accepts http too', () => {
    expect(pickAvatarUrl({ picture: 'http://idp.internal/avatar.jpg' })).toBe(
      'http://idp.internal/avatar.jpg'
    )
  })

  it('trims surrounding whitespace', () => {
    expect(pickAvatarUrl({ picture: '  https://x.test/a.png\n' })).toBe('https://x.test/a.png')
  })

  it('returns undefined when the claim is absent, empty, or not a string', () => {
    expect(pickAvatarUrl({})).toBeUndefined()
    expect(pickAvatarUrl({ picture: '' })).toBeUndefined()
    expect(pickAvatarUrl({ picture: '   ' })).toBeUndefined()
    expect(pickAvatarUrl({ picture: 42 })).toBeUndefined()
    expect(pickAvatarUrl({ picture: null })).toBeUndefined()
    expect(pickAvatarUrl({ picture: { url: 'https://x.test/a.png' } })).toBeUndefined()
  })

  it('rejects a non-URL string', () => {
    expect(pickAvatarUrl({ picture: 'not-a-url' })).toBeUndefined()
    expect(pickAvatarUrl({ picture: '/relative/a.png' })).toBeUndefined()
  })

  it('rejects a non-http(s) scheme so it cannot become a dangerous <img src>', () => {
    expect(pickAvatarUrl({ picture: 'data:image/png;base64,iVBORw0KGgo=' })).toBeUndefined()
    expect(pickAvatarUrl({ picture: 'javascript:alert(1)' })).toBeUndefined()
  })
})
