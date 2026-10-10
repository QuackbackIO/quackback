import { describe, expect, it } from 'vitest'
import { finishBinding, replayClaimMapping } from '../sso-claim-binder'
import {
  finalizeProfileOutcome,
  generatedNames,
  normalizeBoundEmail,
  synthesizeName,
  usernameFrom,
} from '../sso-profile-outcome'

describe('sso-profile-outcome', () => {
  it('normalizes email the way genericOAuth consumes it', () => {
    expect(normalizeBoundEmail('Jane@Example.COM')).toBe('jane@example.com')
    const bound = finishBinding(
      replayClaimMapping({ mapping: { sources: ['idToken'] } }, [
        { source: 'idToken', claims: { sub: 's', email: 'Jane@Example.COM', name: 'Jane' } },
      ])
    )
    expect(bound.identity.email).toBe('Jane@Example.COM')
    const outcome = finalizeProfileOutcome(bound, { allowMissingEmail: false })
    expect(outcome.kind).toBe('identity')
    expect(outcome.email).toBe('jane@example.com')
    expect(outcome.acceptedClaims.email).toBe('Jane@Example.COM')
  })

  it('synthesizes a name only at finalization', () => {
    const bound = finishBinding(
      replayClaimMapping({ mapping: { sources: ['idToken'] } }, [
        {
          source: 'idToken',
          claims: { sub: 's', email: 'e@x.com', preferred_username: 'SomePilot' },
        },
      ])
    )
    expect(bound.identity.name).toBeUndefined()
    const outcome = finalizeProfileOutcome(bound, { allowMissingEmail: false })
    expect(outcome.kind).toBe('identity')
    expect(outcome.name).toBe('SomePilot')
    expect(outcome.nameSynthesized).toBe(true)
  })

  it('reports placeholder_required without minting an address', () => {
    const bound = finishBinding(
      replayClaimMapping({ mapping: { sources: ['idToken'] } }, [
        { source: 'idToken', claims: { sub: 'steam-1', name: 'Pilot' } },
      ])
    )
    const outcome = finalizeProfileOutcome(bound, { allowMissingEmail: true })
    expect(outcome.kind).toBe('placeholder_required')
    expect(outcome.id).toBe('steam-1')
    expect(outcome.email).toBeUndefined()
    expect(outcome.placeholderEmail).toBe(true)
    expect(outcome.emailVerified).toBe(false)
  })

  it('reports missing_email when placeholders are off', () => {
    const bound = finishBinding(
      replayClaimMapping({ mapping: { sources: ['idToken'] } }, [
        { source: 'idToken', claims: { sub: 's', name: 'N' } },
      ])
    )
    const outcome = finalizeProfileOutcome(bound, { allowMissingEmail: false })
    expect(outcome.kind).toBe('missing_email')
    expect(outcome.placeholderEmail).toBe(false)
    expect(outcome.email).toBeUndefined()
  })

  it('reports missing_id when nothing yielded a subject', () => {
    const bound = finishBinding(
      replayClaimMapping({ mapping: { sources: ['idToken'] } }, [
        { source: 'idToken', claims: { email: 'e@x.com', name: 'N' } },
      ])
    )
    const outcome = finalizeProfileOutcome(bound, { allowMissingEmail: false })
    expect(outcome.kind).toBe('missing_id')
    expect(outcome.id).toBeUndefined()
  })

  it('synthesizeName prefers a handle, then nickname, then a readable subject', () => {
    expect(
      synthesizeName({ preferred_username: 'SomePilot', nickname: 'sp' }, 'CHARACTER:EVE:2119')
    ).toBe('SomePilot')
    expect(synthesizeName({ nickname: 'sp' }, 'CHARACTER:EVE:2119')).toBe('sp')
    const fromSubject = synthesizeName({}, 'ACCOUNT:REGION:2119123456')
    expect(fromSubject.length).toBeGreaterThan(0)
    expect(fromSubject).not.toContain(':')
  })
})

describe('synthesizeName with a mapped username claim', () => {
  it('uses the mapped claim, including a nested path, before the subject', () => {
    expect(
      synthesizeName(
        { user: { handle: 'sam_lee' }, preferred_username: 'other' },
        '42',
        'user.handle'
      )
    ).toBe('sam_lee')
  })

  it('skips the standard handle claims once a username claim is mapped', () => {
    expect(
      synthesizeName({ preferred_username: 'other', nickname: 'nick' }, '42', 'user.handle')
    ).toBe('42')
  })

  it('keeps the standard order when no username claim is mapped', () => {
    expect(synthesizeName({ preferred_username: 'pref', nickname: 'nick' }, '42')).toBe('pref')
  })

  it('names an account from the mapped username when the provider sends no name', () => {
    const bound = finishBinding(
      replayClaimMapping({ mapping: { sources: ['idToken'] } }, [
        {
          source: 'idToken',
          claims: { sub: '42', email: 'a@example.com', profile: { handle: 'ally' } },
        },
      ])
    )
    const outcome = finalizeProfileOutcome(bound, {
      allowMissingEmail: false,
      usernameClaim: 'profile.handle',
    })
    expect(outcome.name).toBe('ally')
    expect(outcome.nameSynthesized).toBe(true)
  })
})

describe('usernameFrom', () => {
  it('reads preferred_username, then nickname, when no claim is mapped', () => {
    expect(usernameFrom({ preferred_username: 'pref', nickname: 'nick' })).toBe('pref')
    expect(usernameFrom({ preferred_username: '  ', nickname: 'nick' })).toBe('nick')
    expect(usernameFrom({})).toBeUndefined()
  })

  it('reads only the mapped claim, trimmed, including a nested path', () => {
    expect(usernameFrom({ user: { handle: ' sam_lee ' } }, 'user.handle')).toBe('sam_lee')
    expect(usernameFrom({ preferred_username: 'pref' }, 'user.handle')).toBeUndefined()
    expect(usernameFrom({ user: { handle: 42 } }, 'user.handle')).toBeUndefined()
  })
})

describe('generatedNames', () => {
  it('holds the synthesized name and the subject-only name', () => {
    expect(generatedNames({ preferred_username: 'ada' }, 'ACCOUNT:REGION:2119123456')).toEqual([
      'ada',
      'ACCOUNT REGION 2119123456',
    ])
  })

  it('lists one name when there is no handle', () => {
    expect(generatedNames({}, 'you@example.com')).toEqual(['you'])
    expect(generatedNames({}, '::')).toEqual(['Member'])
  })

  it('follows a mapped username claim', () => {
    expect(
      generatedNames(
        { profile: { handle: 'ally' }, preferred_username: 'x' },
        '42',
        'profile.handle'
      )
    ).toEqual(['ally', '42'])
  })

  it('always includes the name synthesizeName gives', () => {
    const claims = { nickname: 'nick' }
    expect(generatedNames(claims, 'acct|42')).toContain(synthesizeName(claims, 'acct|42'))
  })
})

describe('profile outcome username and avatar', () => {
  it('carries the username and the bound avatar', () => {
    const bound = finishBinding(
      replayClaimMapping({ mapping: { sources: ['idToken'] }, wantImage: true }, [
        {
          source: 'idToken',
          claims: {
            sub: '42',
            email: 'a@example.com',
            name: 'Ally',
            preferred_username: 'ally',
            picture: 'https://cdn.example.com/123/456',
          },
        },
      ])
    )
    const outcome = finalizeProfileOutcome(bound, { allowMissingEmail: false })
    expect(outcome.username).toBe('ally')
    expect(outcome.image).toBe('https://cdn.example.com/123/456')
  })

  it('reads the username from the mapped claim alone', () => {
    const bound = finishBinding(
      replayClaimMapping({ mapping: { sources: ['idToken'] } }, [
        {
          source: 'idToken',
          claims: { sub: '42', email: 'a@example.com', preferred_username: 'other' },
        },
      ])
    )
    const outcome = finalizeProfileOutcome(bound, {
      allowMissingEmail: false,
      usernameClaim: 'profile.handle',
    })
    expect(outcome.username).toBeUndefined()
    expect(outcome.image).toBeUndefined()
  })
})
