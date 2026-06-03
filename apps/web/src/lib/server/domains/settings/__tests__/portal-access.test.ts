/**
 * Unit tests for evaluatePortalAccess().
 *
 * Pure function — no DB, no mocks needed.
 */
import { describe, it, expect } from 'vitest'
import { evaluatePortalAccess } from '../portal-access'

describe('evaluatePortalAccess — public portal', () => {
  it('always grants when visibility is public, no session', () => {
    const result = evaluatePortalAccess({
      visibility: 'public',
      role: null,
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
    })
    expect(result.granted).toBe(true)
    if (result.granted) {
      expect(result.reason).toBe('public')
    }
  })

  it('always grants when visibility is public, even for anonymous session', () => {
    const result = evaluatePortalAccess({
      visibility: 'public',
      role: null,
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
    })
    expect(result.granted).toBe(true)
  })
})

describe('evaluatePortalAccess — private portal, team members', () => {
  it('grants access for admin', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'admin',
      isAuthenticated: true,
      userEmail: 'admin@example.com',
      emailVerified: true,
      allowedDomains: [],
    })
    expect(result.granted).toBe(true)
    if (result.granted) {
      expect(result.reason).toBe('team')
    }
  })

  it('grants access for member', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'member',
      isAuthenticated: true,
      userEmail: 'member@example.com',
      emailVerified: true,
      allowedDomains: [],
    })
    expect(result.granted).toBe(true)
    if (result.granted) {
      expect(result.reason).toBe('team')
    }
  })

  it('does NOT grant via team branch for anonymous principal with a team role', () => {
    // Defense-in-depth: an anonymous principal carrying a team role must NOT
    // be granted access via the team branch. isAuthenticated=false ensures
    // the evaluator does not treat this as a real team member.
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'admin',
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
    })
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthenticated')
    }
  })
})

describe('evaluatePortalAccess — private portal, non-team', () => {
  it('returns unauthenticated when no session (anonymous)', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: null,
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
    })
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthenticated')
    }
  })

  it('returns unauthenticated when principal is anonymous (anonymous Better Auth session)', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: null,
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
    })
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthenticated')
    }
  })

  it('returns unauthorized for authenticated portal user (role=user)', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'user@notlisted.com',
      emailVerified: true,
      allowedDomains: [],
    })
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthorized')
    }
  })
})

describe('evaluatePortalAccess — private portal, allowed email domains', () => {
  it('grants access when verified email domain is on the allowlist', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'alice@acme.com',
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    expect(result.granted).toBe(true)
    if (result.granted) {
      expect(result.reason).toBe('domain')
    }
  })

  it('denies access when email domain matches but email is NOT verified', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'alice@acme.com',
      emailVerified: false,
      allowedDomains: ['acme.com'],
    })
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthorized')
    }
  })

  it('denies access when authenticated but domain is not on the allowlist', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'bob@other.com',
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthorized')
    }
  })

  it('denies when unauthenticated even though domain would match', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: null,
      isAuthenticated: false,
      userEmail: 'alice@acme.com',
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthenticated')
    }
  })

  it('domain match is case-insensitive for the email', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'Alice@ACME.COM',
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    expect(result.granted).toBe(true)
    if (result.granted) {
      expect(result.reason).toBe('domain')
    }
  })

  it('grants access via domain even when allowedDomains has multiple entries', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'carol@partner.io',
      emailVerified: true,
      allowedDomains: ['acme.com', 'partner.io', 'another.org'],
    })
    expect(result.granted).toBe(true)
    if (result.granted) {
      expect(result.reason).toBe('domain')
    }
  })

  it('public portal grants regardless of allowedDomains being empty', () => {
    const result = evaluatePortalAccess({
      visibility: 'public',
      role: null,
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
    })
    expect(result.granted).toBe(true)
    if (result.granted) {
      expect(result.reason).toBe('public')
    }
  })
})

describe('evaluatePortalAccess — private portal, accepted portal invite', () => {
  it('grants access when hasAcceptedPortalInvite=true, verified email, authenticated', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'invitee@example.com',
      emailVerified: true,
      allowedDomains: [],
      hasAcceptedPortalInvite: true,
    })
    expect(result.granted).toBe(true)
    if (result.granted) {
      expect(result.reason).toBe('invite')
    }
  })

  it('SECURITY: does NOT grant when invite is accepted but email is NOT verified', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'invitee@example.com',
      emailVerified: false,
      allowedDomains: [],
      hasAcceptedPortalInvite: true,
    })
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthorized')
    }
  })

  it('does NOT grant when hasAcceptedPortalInvite=false', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'invitee@example.com',
      emailVerified: true,
      allowedDomains: [],
      hasAcceptedPortalInvite: false,
    })
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthorized')
    }
  })

  it('does NOT grant when unauthenticated even with hasAcceptedPortalInvite=true', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: null,
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
      hasAcceptedPortalInvite: true,
    })
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthenticated')
    }
  })

  it('defaults hasAcceptedPortalInvite=false when omitted — existing callers unaffected', () => {
    // The field is optional; omitting it is equivalent to false.
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'user@example.com',
      emailVerified: true,
      allowedDomains: [],
    })
    expect(result.granted).toBe(false)
  })

  it('team grant takes precedence over invite (team checked first)', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'admin',
      isAuthenticated: true,
      userEmail: 'admin@example.com',
      emailVerified: true,
      allowedDomains: [],
      hasAcceptedPortalInvite: true,
    })
    expect(result.granted).toBe(true)
    if (result.granted) {
      // Team branch fires before invite branch.
      expect(result.reason).toBe('team')
    }
  })
})

describe('evaluatePortalAccess — segment branch', () => {
  it('grants a user in an allowed segment', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      emailVerified: true,
      userEmail: 'user@external.com',
      allowedDomains: [],
      hasAcceptedPortalInvite: false,
      widgetSignInEnabled: false,
      hasViaWidgetMarker: false,
      identifyVerificationEnabled: false,
      isInAllowedSegment: true,
    })
    expect(result).toEqual({ granted: true, reason: 'segment' })
  })

  it('denies a user NOT in any allowed segment when no other branch grants', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      emailVerified: true,
      userEmail: 'user@external.com',
      allowedDomains: [],
      hasAcceptedPortalInvite: false,
      widgetSignInEnabled: false,
      hasViaWidgetMarker: false,
      identifyVerificationEnabled: false,
      isInAllowedSegment: false,
    })
    expect(result).toEqual({ granted: false, reason: 'unauthorized' })
  })

  it('does NOT grant via segment when unauthenticated, even if isInAllowedSegment=true', () => {
    // defensive: segment membership without an authenticated session must not grant
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: null,
      isAuthenticated: false,
      emailVerified: false,
      userEmail: null,
      allowedDomains: [],
      hasAcceptedPortalInvite: false,
      widgetSignInEnabled: false,
      hasViaWidgetMarker: false,
      identifyVerificationEnabled: false,
      isInAllowedSegment: true, // shouldn't grant — caller is anonymous
    })
    expect(result.granted).toBe(false)
    expect(result.reason).toBe('unauthenticated')
  })
})

describe('evaluatePortalAccess — invite precedence (continued)', () => {
  it('domain grant takes precedence over invite (domain checked before invite)', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'user@acme.com',
      emailVerified: true,
      allowedDomains: ['acme.com'],
      hasAcceptedPortalInvite: true,
    })
    expect(result.granted).toBe(true)
    if (result.granted) {
      // Domain branch fires before invite branch.
      expect(result.reason).toBe('domain')
    }
  })
})

describe('evaluatePortalAccess — segment branch edge cases', () => {
  it('REFUSES to grant via segment when emailVerified=false (G9)', () => {
    // Regression: the segment grant previously fired without checking
    // emailVerified, on the rationale that segments are admin-curated.
    // But a dynamic segment can predicate on email (e.g. `email
    // ends_with @acme.com`) and the evaluator joined users on `u.email`
    // with no verification predicate — so an attacker who signed up as
    // `victim@acme.com` and never verified became a segment member and
    // walked into the private portal. The branch now requires the same
    // emailVerified guard as the domain and invite branches.
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      emailVerified: false,
      userEmail: 'user@external.com',
      allowedDomains: [],
      hasAcceptedPortalInvite: false,
      widgetSignInEnabled: false,
      hasViaWidgetMarker: false,
      identifyVerificationEnabled: false,
      isInAllowedSegment: true,
    })
    expect(result).toEqual({ granted: false, reason: 'unauthorized' })
  })

  it('grants via segment when emailVerified=true and the user is in an allowed segment', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      emailVerified: true,
      userEmail: 'user@external.com',
      allowedDomains: [],
      hasAcceptedPortalInvite: false,
      widgetSignInEnabled: false,
      hasViaWidgetMarker: false,
      identifyVerificationEnabled: false,
      isInAllowedSegment: true,
    })
    expect(result).toEqual({ granted: true, reason: 'segment' })
  })

  it('domain branch wins when both domain and segment would grant', () => {
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      emailVerified: true,
      userEmail: 'user@acme.com',
      allowedDomains: ['acme.com'],
      hasAcceptedPortalInvite: false,
      widgetSignInEnabled: false,
      hasViaWidgetMarker: false,
      identifyVerificationEnabled: false,
      isInAllowedSegment: true,
    })
    expect(result).toEqual({ granted: true, reason: 'domain' })
  })
})
