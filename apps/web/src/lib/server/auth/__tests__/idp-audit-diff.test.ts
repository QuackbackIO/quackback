import { describe, it, expect } from 'vitest'
import { diffProviderAudit } from '../idp-audit-diff'

const prior = {
  // Immutable on update, so it is on both sides of a real diff.
  registrationId: 'oidc_abc',
  label: 'Acme SSO',
  kind: 'other' as const,
  clientId: 'client-1',
  discoveryUrl: 'https://idp/.well-known/openid-configuration',
  authorizationUrl: null,
  tokenUrl: null,
  userInfoUrl: null,
  jwksUri: null,
  issuer: null,
  scopes: null,
  enabled: true,
  autoCreateUsers: true,
  autoProvisionRole: 'user' as const,
  attributeMapping: null,
  showButton: true,
}

const next = { ...prior }

describe('diffProviderAudit — create', () => {
  it('records the full snapshot when there is no prior row', () => {
    const { before, after } = diffProviderAudit(null, next)
    expect(before).toBeNull()
    expect(after.label).toBe('Acme SSO')
    expect(after.clientId).toBe('client-1')
    expect(after.registrationId).toBe('oidc_abc')
  })
})

describe('diffProviderAudit — update', () => {
  it('records only the fields that changed, on both sides', () => {
    const { before, after } = diffProviderAudit(prior, { ...next, label: 'Renamed' })
    expect(before).toEqual({ label: 'Acme SSO' })
    expect(after).toEqual({ label: 'Renamed' })
  })

  it('captures scopes, which decide which claims the IdP releases', () => {
    const { before, after } = diffProviderAudit(prior, { ...next, scopes: 'openid public' })
    expect(before).toEqual({ scopes: null })
    expect(after).toEqual({ scopes: 'openid public' })
  })

  it('captures every endpoint and the client id', () => {
    const { before, after } = diffProviderAudit(prior, {
      ...next,
      clientId: 'client-2',
      discoveryUrl: 'https://evil/.well-known/openid-configuration',
      userInfoUrl: 'https://evil/userinfo',
    })
    expect(Object.keys(before ?? {}).sort()).toEqual(['clientId', 'discoveryUrl', 'userInfoUrl'])
    expect(after.clientId).toBe('client-2')
    expect(after.userInfoUrl).toBe('https://evil/userinfo')
  })

  it('captures an attribute-mapping change, comparing by value not reference', () => {
    // The abuse this closes: repoint the claim used for identity, sign in as
    // someone else, repoint back. Both saves previously produced byte-identical
    // audit rows recording only label and enabled.
    const mapping = { claimPath: 'groups', rules: [], syncOnEverySignIn: false }
    const changed = diffProviderAudit(prior, { ...next, attributeMapping: mapping })
    expect(changed.before).toEqual({ attributeMapping: null })
    expect(changed.after.attributeMapping).toEqual(mapping)

    const unchanged = diffProviderAudit(
      { ...prior, attributeMapping: mapping },
      { ...next, attributeMapping: { ...mapping } }
    )
    expect(unchanged.before).toEqual({})
    expect(unchanged.after).toEqual({})
  })

  it('records nothing when nothing changed', () => {
    const { before, after } = diffProviderAudit(prior, next)
    expect(before).toEqual({})
    expect(after).toEqual({})
  })

  it('ignores fields the caller did not supply, honouring patch semantics', () => {
    // An omitted optional leaves the column untouched, so it is not a change.
    const { before, after } = diffProviderAudit(prior, {
      registrationId: 'oidc_abc',
      label: 'Acme SSO',
      clientId: 'client-1',
    })
    expect(before).toEqual({})
    expect(after).toEqual({})
  })
})
