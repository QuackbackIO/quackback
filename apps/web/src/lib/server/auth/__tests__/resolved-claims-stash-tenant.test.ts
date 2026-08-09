/**
 * The OIDC resolved-claims stash, across tenants.
 *
 * Not on SAAS-HOSTING-STACK.md §4.1's list — found by the module-state scanner
 * this piece added, which is the point of having one.
 *
 * The stash carries freshly-validated IdP claims from the resolver to the
 * role-provisioning hook, keyed by `providerId + accountId`. Neither half is
 * unique across workspaces: `google` is `google` everywhere, and the account id
 * is the IdP's subject, the same string for the same human in every workspace
 * they belong to. Shared, one person signing into two workspaces at once has
 * the second sign-in drain claims resolved against the first — and those claims
 * are the input to role assignment, so the wrong workspace's `groups` decide
 * what the user can do. It is silent: the role mapping runs normally.
 *
 * Same class as `magicLinkStash`, which §4.1 heads its table with and calls
 * account-takeover adjacent.
 */
import { describe, it, expect } from 'vitest'
import { stashResolvedClaims, takeResolvedClaims } from '../resolved-claims-stash'
import { withTenant } from '@/lib/server/__tests__/tenant-scope'

const PROVIDER = 'google'
const SUBJECT = '110248495921238986420'

describe('the same identity signing into two workspaces', () => {
  it('does not hand workspace B the claims resolved for workspace A', () => {
    withTenant('tenant-alpha', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { groups: ['alpha-admins'] })
    )

    expect(withTenant('tenant-bravo', () => takeResolvedClaims(PROVIDER, SUBJECT))).toBeNull()
    // …and alpha's own entry is still there, so the isolation is not just
    // "everything is empty".
    expect(withTenant('tenant-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      groups: ['alpha-admins'],
    })
  })

  it('does not hand workspace A the claims resolved for workspace B', () => {
    withTenant('tenant-bravo', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { groups: ['bravo-admins'] })
    )

    expect(withTenant('tenant-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toBeNull()
    expect(withTenant('tenant-bravo', () => takeResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      groups: ['bravo-admins'],
    })
  })

  it('keeps both entries alive at once — a second stash does not overwrite the first', () => {
    // The overwrite is the mechanism, so it gets its own case. With one shared
    // Map the second `set` replaces the first and only one workspace can be
    // wrong; the pair below shows both survive independently.
    withTenant('tenant-alpha', () => stashResolvedClaims(PROVIDER, SUBJECT, { role: 'admin' }))
    withTenant('tenant-bravo', () => stashResolvedClaims(PROVIDER, SUBJECT, { role: 'viewer' }))

    expect(withTenant('tenant-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      role: 'admin',
    })
    expect(withTenant('tenant-bravo', () => takeResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      role: 'viewer',
    })
  })

  it('is take-once within a workspace', () => {
    withTenant('tenant-alpha', () => stashResolvedClaims(PROVIDER, SUBJECT, { role: 'admin' }))

    expect(withTenant('tenant-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).not.toBeNull()
    expect(withTenant('tenant-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toBeNull()
  })

  it('still works with no tenant scope, for a self-hosted install', () => {
    stashResolvedClaims(PROVIDER, SUBJECT, { role: 'admin' })
    expect(takeResolvedClaims(PROVIDER, SUBJECT)).toEqual({ role: 'admin' })
  })

  it('does not let an unscoped stash be drained by a tenant, or the reverse', () => {
    stashResolvedClaims(PROVIDER, SUBJECT, { role: 'self-hosted' })
    expect(withTenant('tenant-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toBeNull()
    expect(takeResolvedClaims(PROVIDER, SUBJECT)).toEqual({ role: 'self-hosted' })
  })
})
