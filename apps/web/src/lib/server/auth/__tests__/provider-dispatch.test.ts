import { describe, it, expect } from 'vitest'
import {
  findProviderForDomainEmail,
  isRegisteredOidcProvider,
  type ProviderWithDomains,
} from '../provider-ids'
import { isHardBound, isSsoBlockedForRole } from '../auth-restrictions'

describe('isRegisteredOidcProvider', () => {
  const reg = new Set(['sso', 'custom-oidc', 'oidc_idp_abc'])
  it('matches registered provider ids incl. preserved legacy ids', () => {
    expect(isRegisteredOidcProvider('sso', reg)).toBe(true)
    expect(isRegisteredOidcProvider('oidc_idp_abc', reg)).toBe(true)
  })
  it('does not match social or unknown ids', () => {
    expect(isRegisteredOidcProvider('google', reg)).toBe(false)
    expect(isRegisteredOidcProvider('oidc_idp_unknown', reg)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fixtures: provider A owns the ENFORCED domain acme.com (registrationId
// 'sso' — exercises the preserved legacy id). Provider B ('oidc_idp_b') owns
// a different verified domain. Both are registered.
// ---------------------------------------------------------------------------
const verified = (name: string, enforced: boolean) => ({
  name,
  verifiedAt: '2026-05-01T00:00:00.000Z',
  enforced,
})

const providerA: ProviderWithDomains = {
  id: 'idp_a',
  registrationId: 'sso',
  domains: [verified('acme.com', true)],
}
const providerB: ProviderWithDomains = {
  id: 'idp_b',
  registrationId: 'oidc_idp_b',
  domains: [verified('beta.com', true)],
}
const providers = [providerA, providerB]
const registered = new Set(['sso', 'oidc_idp_b'])

describe('findProviderForDomainEmail', () => {
  it('resolves the owning provider + the matched domain enforced flag', () => {
    expect(findProviderForDomainEmail('alice@acme.com', providers)).toEqual({
      id: 'idp_a',
      registrationId: 'sso',
      enforced: true,
    })
  })

  it('ignores unverified (verifiedAt=null) domains', () => {
    const pending: ProviderWithDomains = {
      id: 'idp_p',
      registrationId: 'oidc_pending',
      domains: [{ name: 'acme.com', verifiedAt: null, enforced: true }],
    }
    expect(findProviderForDomainEmail('alice@acme.com', [pending])).toBeNull()
  })

  it('returns null when no provider owns the email domain', () => {
    expect(findProviderForDomainEmail('alice@nowhere.com', providers)).toBeNull()
  })
})

describe('isHardBound — C2 owning-provider rule', () => {
  it('C2 bypass blocked: a DIFFERENT registered OIDC provider B cannot satisfy A’s enforced domain', () => {
    // alice@acme.com is enforced & owned by A ('sso'). Provider B asserting
    // the same email must NOT be exempt — that is the bypass C2 closes.
    expect(isHardBound('oidc_idp_b', 'alice@acme.com', providers, registered)).toBe(true)
  })

  it('owner exempt: the owning provider’s own callback is the enforced method', () => {
    expect(isHardBound('sso', 'alice@acme.com', providers, registered)).toBe(false)
  })

  it('blocks password / magic-link / social at the enforced domain', () => {
    expect(isHardBound('credential', 'alice@acme.com', providers, registered)).toBe(true)
    expect(isHardBound('magic-link', 'alice@acme.com', providers, registered)).toBe(true)
    expect(isHardBound('google', 'alice@acme.com', providers, registered)).toBe(true)
  })

  it('fail-open is SCOPED to the owner: owner A unregistered → password not hard-bound', () => {
    // Anti-self-lockout: A's IdP isn't viable (tier downgrade / missing
    // secret), so the enforced domain's block lifts for OTHER methods.
    const onlyBRegistered = new Set(['oidc_idp_b'])
    expect(isHardBound('credential', 'alice@acme.com', providers, onlyBRegistered)).toBe(false)
  })

  it('fail-open does NOT trigger on an unrelated provider being unregistered (the C2 hole)', () => {
    // B unregistered must not lift A's enforcement: password at A's enforced
    // domain stays blocked because A itself IS registered.
    const onlyARegistered = new Set(['sso'])
    expect(isHardBound('credential', 'alice@acme.com', providers, onlyARegistered)).toBe(true)
    // And B's callback for A's email is still blocked.
    expect(isHardBound('oidc_idp_b', 'alice@acme.com', providers, onlyARegistered)).toBe(true)
  })

  it('non-enforced domain: email at a verified-but-not-enforced domain is not hard-bound', () => {
    const routingOnly: ProviderWithDomains = {
      id: 'idp_a',
      registrationId: 'sso',
      domains: [verified('acme.com', false)],
    }
    expect(isHardBound('credential', 'alice@acme.com', [routingOnly], registered)).toBe(false)
  })

  it('email at no verified domain is never hard-bound', () => {
    expect(isHardBound('credential', 'alice@nowhere.com', providers, registered)).toBe(false)
  })
})

describe('isSsoBlockedForRole — portal eligibility', () => {
  // A public, button-only provider has no verified domains.
  const buttonOnly: ProviderWithDomains = {
    id: 'idp_pub',
    registrationId: 'custom-oidc',
    domains: [],
  }
  const all = [...providers, buttonOnly]

  it('does NOT block a portal user on a button-only provider (C2 regression)', () => {
    // Regression: generalizing the team-SSO domain gate to all OIDC providers
    // blocked every portal user on a button-only provider — and the brand-new
    // shell cleanup then deleted their just-created account.
    expect(isSsoBlockedForRole('user', 'anyone@anywhere.com', 'custom-oidc', all)).toBe(false)
  })

  it('blocks a portal user whose email is NOT at a routed provider’s verified domain', () => {
    expect(isSsoBlockedForRole('user', 'eve@evil.com', 'sso', all)).toBe(true)
  })

  it('allows a portal user whose email IS at the routed provider’s verified domain', () => {
    expect(isSsoBlockedForRole('user', 'alice@acme.com', 'sso', all)).toBe(false)
  })

  it('never blocks a team member, regardless of provider/domain', () => {
    expect(isSsoBlockedForRole('admin', 'eve@evil.com', 'sso', all)).toBe(false)
    expect(isSsoBlockedForRole('member', 'eve@evil.com', 'custom-oidc', all)).toBe(false)
  })

  it('blocks an unknown provider (fail closed for portal users)', () => {
    expect(isSsoBlockedForRole('user', 'alice@acme.com', 'oidc_unknown', all)).toBe(true)
  })
})
