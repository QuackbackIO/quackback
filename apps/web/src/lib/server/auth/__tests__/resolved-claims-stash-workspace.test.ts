/**
 * The OIDC resolved-claims stash, across workspaces.
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
import {
  peekResolvedClaims,
  stashResolvedClaims,
  takeResolvedClaims,
} from '../resolved-claims-stash'
import { withWorkspace } from '@/lib/server/__tests__/workspace-scope'

const PROVIDER = 'google'
const SUBJECT = '110248495921238986420'

describe('the same identity signing into two workspaces', () => {
  it('does not hand workspace B the claims resolved for workspace A', () => {
    withWorkspace('workspace-alpha', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { groups: ['alpha-admins'] })
    )

    expect(withWorkspace('workspace-bravo', () => takeResolvedClaims(PROVIDER, SUBJECT))).toBeNull()
    // …and alpha's own entry is still there, so the isolation is not just
    // "everything is empty".
    expect(withWorkspace('workspace-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      groups: ['alpha-admins'],
    })
  })

  it('does not hand workspace A the claims resolved for workspace B', () => {
    withWorkspace('workspace-bravo', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { groups: ['bravo-admins'] })
    )

    expect(withWorkspace('workspace-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toBeNull()
    expect(withWorkspace('workspace-bravo', () => takeResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      groups: ['bravo-admins'],
    })
  })

  it('keeps both entries alive at once — a second stash does not overwrite the first', () => {
    // The overwrite is the mechanism, so it gets its own case. With one shared
    // Map the second `set` replaces the first and only one workspace can be
    // wrong; the pair below shows both survive independently.
    withWorkspace('workspace-alpha', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { role: 'admin' })
    )
    withWorkspace('workspace-bravo', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { role: 'viewer' })
    )

    expect(withWorkspace('workspace-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      role: 'admin',
    })
    expect(withWorkspace('workspace-bravo', () => takeResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      role: 'viewer',
    })
  })

  it('is take-once within a workspace', () => {
    withWorkspace('workspace-alpha', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { role: 'admin' })
    )

    expect(
      withWorkspace('workspace-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))
    ).not.toBeNull()
    expect(withWorkspace('workspace-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toBeNull()
  })

  it('still works with no workspace scope, for a self-hosted install', () => {
    stashResolvedClaims(PROVIDER, SUBJECT, { role: 'admin' })
    expect(takeResolvedClaims(PROVIDER, SUBJECT)).toEqual({ role: 'admin' })
  })

  it('peek reads without consuming, so a later take still gets the claims', () => {
    withWorkspace('workspace-alpha', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { picture: 'https://cdn/a.png' })
    )
    expect(withWorkspace('workspace-alpha', () => peekResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      picture: 'https://cdn/a.png',
    })
    // The avatar backfill peeks; role provisioning still takes.
    expect(withWorkspace('workspace-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      picture: 'https://cdn/a.png',
    })
    expect(withWorkspace('workspace-alpha', () => peekResolvedClaims(PROVIDER, SUBJECT))).toBeNull()
  })

  it('peek respects workspace isolation', () => {
    withWorkspace('workspace-alpha', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { picture: 'https://cdn/a.png' })
    )
    expect(withWorkspace('workspace-bravo', () => peekResolvedClaims(PROVIDER, SUBJECT))).toBeNull()
    // Drain so the entry doesn't leak into a later unscoped test.
    withWorkspace('workspace-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))
  })

  it('does not let an unscoped stash be drained by a workspace, or the reverse', () => {
    stashResolvedClaims(PROVIDER, SUBJECT, { role: 'self-hosted' })
    expect(withWorkspace('workspace-alpha', () => takeResolvedClaims(PROVIDER, SUBJECT))).toBeNull()
    expect(takeResolvedClaims(PROVIDER, SUBJECT)).toEqual({ role: 'self-hosted' })
  })
})
