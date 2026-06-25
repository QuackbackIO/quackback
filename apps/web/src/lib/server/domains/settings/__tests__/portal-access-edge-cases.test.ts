/**
 * Deep edge-case coverage for the portal-access module.
 *
 * Covers:
 *  - evaluatePortalAccess: all remaining decision-table branches and edge cases.
 *  - emailDomain helper: edge cases exercised through evaluatePortalAccess.
 */
import { describe, it, expect } from 'vitest'
import { evaluatePortalAccess } from '../portal-access'

// ============================================================================
// evaluatePortalAccess — complete decision truth table
// ============================================================================

describe('evaluatePortalAccess — full decision truth table', () => {
  // ─── Public portal ────────────────────────────────────────────────────────

  it('[public] grants any caller: null role, not authenticated', () => {
    const r = evaluatePortalAccess({
      visibility: 'public',
      role: null,
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
    })
    expect(r).toEqual({ granted: true, reason: 'public' })
  })

  it('[public] grants admin role, authenticated', () => {
    const r = evaluatePortalAccess({
      visibility: 'public',
      role: 'admin',
      isAuthenticated: true,
      userEmail: 'admin@acme.com',
      emailVerified: true,
      allowedDomains: [],
    })
    expect(r).toEqual({ granted: true, reason: 'public' })
  })

  it('[public] grants even when allowedDomains is non-empty (public ignores the list)', () => {
    const r = evaluatePortalAccess({
      visibility: 'public',
      role: null,
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: ['restricted.com'],
    })
    expect(r).toEqual({ granted: true, reason: 'public' })
  })

  // ─── Private + team ────────────────────────────────────────────────────────

  it('[private+team] grants admin when authenticated', () => {
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'admin',
      isAuthenticated: true,
      userEmail: 'a@acme.com',
      emailVerified: true,
      allowedDomains: [],
    })
    expect(r).toEqual({ granted: true, reason: 'team' })
  })

  it('[private+team] grants member when authenticated', () => {
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'member',
      isAuthenticated: true,
      userEmail: 'm@acme.com',
      emailVerified: true,
      allowedDomains: [],
    })
    expect(r).toEqual({ granted: true, reason: 'team' })
  })

  it('[private+team] DENIES admin with isAuthenticated=false (anonymous principal carrying a role)', () => {
    // Security-critical: an anonymous principal carrying admin role must not pass.
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'admin',
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
    })
    expect(r.granted).toBe(false)
    if (!r.granted) expect(r.reason).toBe('unauthenticated')
  })

  it('[private+team] DENIES member with isAuthenticated=false', () => {
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'member',
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
    })
    expect(r.granted).toBe(false)
    if (!r.granted) expect(r.reason).toBe('unauthenticated')
  })

  // ─── Private + anonymous ───────────────────────────────────────────────────

  it('[private+anon] denies anonymous (no session) — reason: unauthenticated', () => {
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: null,
      isAuthenticated: false,
      userEmail: null,
      emailVerified: false,
      allowedDomains: [],
    })
    expect(r).toEqual({ granted: false, reason: 'unauthenticated' })
  })

  // ─── Private + non-team, authenticated ────────────────────────────────────

  it('[private+user] verified email on allowlist → granted (domain)', () => {
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'alice@acme.com',
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    expect(r).toEqual({ granted: true, reason: 'domain' })
  })

  it('[private+user] verified email but domain NOT on allowlist → denied (unauthorized)', () => {
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'bob@other.com',
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    expect(r).toEqual({ granted: false, reason: 'unauthorized' })
  })

  it('[private+user] SECURITY: unverified email whose domain IS on allowlist → denied', () => {
    // This is the critical security invariant: emailVerified=false must block
    // access even when the domain would otherwise match.
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'alice@acme.com',
      emailVerified: false, // <-- unverified
      allowedDomains: ['acme.com'],
    })
    expect(r.granted).toBe(false)
    if (!r.granted) expect(r.reason).toBe('unauthorized')
  })

  it('[private+user] empty allowlist → denied (unauthorized)', () => {
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'alice@acme.com',
      emailVerified: true,
      allowedDomains: [],
    })
    expect(r).toEqual({ granted: false, reason: 'unauthorized' })
  })
})

// ============================================================================
// emailDomain edge cases — exercised through evaluatePortalAccess
// ============================================================================

describe('evaluatePortalAccess — domain matching edge cases', () => {
  it('case-insensitive: User@ACME.COM matches allowlist entry acme.com', () => {
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'User@ACME.COM',
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    expect(r).toEqual({ granted: true, reason: 'domain' })
  })

  it('subdomain: user@mail.acme.com against acme.com → exact domain match expected, so denied', () => {
    // The evaluator uses lastIndexOf('@') + toLowerCase — it extracts "mail.acme.com".
    // "mail.acme.com" is not "acme.com", so the match fails.
    // This asserts the ACTUAL behavior: no subdomain matching.
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'user@mail.acme.com',
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    // Exact-domain match only: mail.acme.com ≠ acme.com → denied
    expect(r.granted).toBe(false)
    if (!r.granted) expect(r.reason).toBe('unauthorized')
  })

  it('email with no @: emailDomain returns null → denied without crash', () => {
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'notanemail',
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    expect(r.granted).toBe(false)
    // Should not throw; reason can be unauthorized (isAuthenticated=true)
    if (!r.granted) expect(r.reason).toBe('unauthorized')
  })

  it('email with multiple @: lastIndexOf picks the correct domain part', () => {
    // E.g. "foo@bar@acme.com" — lastIndexOf('@') extracts "acme.com".
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'foo@bar@acme.com',
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    // lastIndexOf('@') on 'foo@bar@acme.com' gives index 7, so domain = 'acme.com'
    // This is the actual behavior; assert it.
    expect(r.granted).toBe(true)
    if (r.granted) expect(r.reason).toBe('domain')
  })

  it('null userEmail → emailDomain returns null → denied without crash', () => {
    const r = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: null,
      emailVerified: true,
      allowedDomains: ['acme.com'],
    })
    expect(r.granted).toBe(false)
  })
})
