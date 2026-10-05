import { describe, expect, it } from 'vitest'
import { finishBinding, replayClaimMapping } from '../sso-claim-binder'
import { finalizeProfileOutcome, normalizeBoundEmail, synthesizeName } from '../sso-profile-outcome'

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
