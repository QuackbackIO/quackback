import { describe, expect, it } from 'vitest'
import {
  advanceBindingState,
  bindingComplete,
  createBindingState,
  finishBinding,
  replayClaimMapping,
  type BindingConfig,
} from '../sso-claim-binder'
import type { SourceSnapshot } from '../oidc-claim-mapping'

function replay(config: BindingConfig, snapshots: SourceSnapshot[]) {
  return finishBinding(replayClaimMapping(config, snapshots))
}

describe('sso-claim-binder', () => {
  it('single path uses later valid scalar despite earlier unusable raw value', () => {
    const unusable = [null, '', ['not-a-scalar']] as const
    for (const earlier of unusable) {
      const result = replay({ mapping: { sources: ['idToken', 'userinfo'] } }, [
        { source: 'idToken', claims: { sub: 's', email: earlier, name: 'N' } },
        { source: 'userinfo', claims: { sub: 's', email: 'ok@x.com', name: 'N' } },
      ])
      expect(result.identity.email).toBe('ok@x.com')
      expect(result.provenance.email).toEqual({ source: 'userinfo', path: 'email' })
      expect(result.acceptedClaims.email).toEqual(earlier)
    }

    const numberResult = replay({ mapping: { sources: ['idToken', 'userinfo'] } }, [
      { source: 'idToken', claims: { sub: 's', email: 42, name: 'N' } },
      { source: 'userinfo', claims: { sub: 's', email: 'later@x.com', name: 'N' } },
    ])
    expect(numberResult.identity.email).toBe('42')
    expect(numberResult.provenance.email?.source).toBe('idToken')

    const imageResult = replay({ mapping: { sources: ['idToken', 'userinfo'] }, wantImage: true }, [
      {
        source: 'idToken',
        claims: { sub: 's', email: 'e@x.com', name: 'N', picture: 'not-a-url' },
      },
      {
        source: 'userinfo',
        claims: { sub: 's', picture: 'https://cdn.example.com/a.png' },
      },
    ])
    expect(imageResult.identity.image).toBe('https://cdn.example.com/a.png')
    expect(imageResult.provenance.image).toEqual({ source: 'userinfo', path: 'picture' })
    expect(imageResult.acceptedClaims.picture).toBe('not-a-url')
  })

  it('default userinfo id fallback differs from explicit sub', () => {
    const snapshots: SourceSnapshot[] = [
      { source: 'userinfo', claims: { id: 'legacy-id', email: 'e@x.com', name: 'N' } },
    ]
    const implicit = replay({ mapping: { sources: ['userinfo'] } }, snapshots)
    expect(implicit.identity.id).toBe('legacy-id')
    expect(implicit.provenance.id).toEqual({ source: 'userinfo', path: 'id' })

    const explicit = replay({ mapping: { sources: ['userinfo'], idClaim: 'sub' } }, snapshots)
    expect(explicit.identity.id).toBeUndefined()
    expect(explicit.provenance.id).toBeUndefined()
  })

  it('incomplete subject replacement discards prior subject role and People claims', () => {
    const result = replay(
      {
        mapping: { sources: ['idToken', 'userinfo'] },
        requiredClaimPaths: ['groups', 'org.department'],
      },
      [
        {
          source: 'idToken',
          claims: { sub: 'from-token', groups: ['eng'], org: { department: 'TokenDept' } },
        },
        {
          source: 'userinfo',
          claims: {
            sub: 'from-userinfo',
            email: 'e@x.com',
            name: 'N',
            groups: ['ops'],
            org: { department: 'UserinfoDept' },
          },
        },
      ]
    )
    expect(result.identity.id).toBe('from-userinfo')
    expect(result.provenance.id?.source).toBe('userinfo')
    expect(result.acceptedClaims.groups).toEqual(['ops'])
    expect(result.acceptedClaims.org).toEqual({ department: 'UserinfoDept' })
    expect(result.warnings).toContain('subject_mismatch')
  })

  it('complete identity never rekeys for diagnostic or mapped-path userinfo', () => {
    const snapshots: SourceSnapshot[] = [
      { source: 'idToken', claims: { sub: 'from-token', email: 'a@x.com', name: 'A' } },
      {
        source: 'userinfo',
        claims: { sub: 'other', email: 'b@x.com', name: 'B', department: 'Eng' },
      },
    ]
    for (const extra of [{ exhaustive: true }, { requiredClaimPaths: ['department'] }] as const) {
      const result = replay({ mapping: { sources: ['idToken', 'userinfo'] }, ...extra }, snapshots)
      expect(result.identity.id).toBe('from-token')
      expect(result.identity.email).toBe('a@x.com')
      expect(result.provenance.id?.source).toBe('idToken')
      expect(result.acceptedClaims.department).toBeUndefined()
      expect(result.warnings).toContain('subject_mismatch')
    }
  })

  it('binder does not mutate captured nested claims', () => {
    const idTokenClaims = {
      sub: 's',
      email: 'e@x.com',
      name: 'N',
      org: { department: 'from-token' },
    }
    const userinfoClaims = { sub: 's', org: { costCenter: 'cc-9', department: 'from-userinfo' } }
    const idBefore = structuredClone(idTokenClaims)
    const userinfoBefore = structuredClone(userinfoClaims)

    const result = replay(
      {
        mapping: { sources: ['idToken', 'userinfo'] },
        requiredClaimPaths: ['org.costCenter'],
      },
      [
        { source: 'idToken', claims: idTokenClaims },
        { source: 'userinfo', claims: userinfoClaims },
      ]
    )

    expect(idTokenClaims).toEqual(idBefore)
    expect(userinfoClaims).toEqual(userinfoBefore)
    expect(idTokenClaims.org).not.toHaveProperty('costCenter')
    expect(result.acceptedClaims.org).toEqual({ department: 'from-token', costCenter: 'cc-9' })
  })

  it('replay stops where production stops', () => {
    const snapshots: SourceSnapshot[] = [
      { source: 'idToken', claims: { sub: 's', email: 'e@x.com', name: 'N' } },
      { source: 'userinfo', claims: { sub: 's', email: 'later@x.com', extra: 'only-userinfo' } },
    ]
    const result = replay({ mapping: { sources: ['idToken', 'userinfo'] } }, snapshots)
    expect(result.identity.email).toBe('e@x.com')
    expect(result.provenance.email?.source).toBe('idToken')
    expect(result.acceptedClaims.extra).toBeUndefined()
    expect(result.sourceAvailability.userinfo).toBeUndefined()
  })

  it('does not treat a synthesizable name as complete during the source walk', () => {
    const result = replay({ mapping: { sources: ['idToken', 'userinfo'] } }, [
      {
        source: 'idToken',
        claims: { sub: 's', email: 'e@x.com', preferred_username: 'handle' },
      },
      { source: 'userinfo', claims: { sub: 's', name: 'From Userinfo' } },
    ])
    expect(result.identity.name).toBe('From Userinfo')
    expect(result.provenance.name?.source).toBe('userinfo')
  })

  it('createBindingState and advanceBindingState are immutable', () => {
    const state = createBindingState({ mapping: { sources: ['idToken', 'userinfo'] } })
    const next = advanceBindingState(state, 'idToken', {
      sub: 's',
      email: 'e@x.com',
      name: 'N',
    })
    expect(state.identity.id).toBeUndefined()
    expect(next.identity.id).toBe('s')
    expect(bindingComplete(state)).toBe(false)
    expect(bindingComplete(next)).toBe(true)
  })

  it('records required-source availability without inventing claims for an unavailable source', () => {
    const result = replay({ mapping: { sources: ['idToken', 'userinfo'] } }, [
      { source: 'idToken', claims: { sub: 's' } },
      { source: 'userinfo', unavailable: 'fetch_failed' },
    ])
    expect(result.identity.id).toBe('s')
    expect(result.sourceAvailability.idToken).toBe('available')
    expect(result.sourceAvailability.userinfo).toBe('fetch_failed')
    expect(result.acceptedClaims).toEqual({ sub: 's' })
  })
})
