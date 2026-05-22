/**
 * Deep edge-case coverage for the portal-access module.
 *
 * Covers:
 *  - evaluatePortalAccess: all remaining decision-table branches and edge cases.
 *  - emailDomain helper: edge cases exercised through evaluatePortalAccess.
 *  - parseGateError (from _portal.tsx): valid gate error, malformed JSON,
 *    partial gate-shaped object, non-Error inputs.
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

// ============================================================================
// parseGateError — inline re-implementation for testing
// (The real function lives in _portal.tsx; we extract its logic to test it
//  without importing the React module.)
// ============================================================================

// Copy of isValidGateError and parseGateError from _portal.tsx so we can
// test them in a unit context without the React+router env.

interface PortalAccessGateErrorShape {
  type: 'portal-access-gate'
  reason: 'unauthenticated' | 'unauthorized'
  workspaceName: string
  logoUrl: string | null
  themeStyles: string
  customCss: string
  authConfig: {
    found: boolean
    oauth: Record<string, boolean | undefined>
    customProviderNames?: Record<string, string>
  }
}

function isValidGateError(obj: unknown): obj is PortalAccessGateErrorShape {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  return (
    o['type'] === 'portal-access-gate' &&
    (o['reason'] === 'unauthenticated' || o['reason'] === 'unauthorized') &&
    typeof o['workspaceName'] === 'string' &&
    (o['logoUrl'] === null || typeof o['logoUrl'] === 'string') &&
    typeof o['themeStyles'] === 'string' &&
    typeof o['customCss'] === 'string' &&
    o['authConfig'] !== null &&
    typeof o['authConfig'] === 'object' &&
    typeof (o['authConfig'] as Record<string, unknown>)['found'] === 'boolean' &&
    typeof (o['authConfig'] as Record<string, unknown>)['oauth'] === 'object'
  )
}

function parseGateError(error: unknown): PortalAccessGateErrorShape | null {
  if (!(error instanceof Error)) return null
  const ext = error as unknown as Record<string, unknown>
  if (isValidGateError(ext)) return ext as unknown as PortalAccessGateErrorShape
  try {
    const parsed: unknown = JSON.parse(error.message)
    if (isValidGateError(parsed)) return parsed as PortalAccessGateErrorShape
  } catch {
    // not a gate error
  }
  return null
}

const VALID_GATE_PAYLOAD: PortalAccessGateErrorShape = {
  type: 'portal-access-gate',
  reason: 'unauthenticated',
  workspaceName: 'Acme',
  logoUrl: null,
  themeStyles: '',
  customCss: '',
  authConfig: { found: true, oauth: { google: true } },
}

describe('parseGateError', () => {
  it('parses a genuine gate-error payload from extra Error properties (fast path)', () => {
    const err = Object.assign(new Error('ignored'), VALID_GATE_PAYLOAD)
    const result = parseGateError(err)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('portal-access-gate')
    expect(result?.reason).toBe('unauthenticated')
  })

  it('parses a gate-error payload from JSON message (SSR serialization path)', () => {
    const err = new Error(JSON.stringify(VALID_GATE_PAYLOAD))
    const result = parseGateError(err)
    expect(result).not.toBeNull()
    expect(result?.workspaceName).toBe('Acme')
  })

  it('returns null for a malformed (non-JSON) error message', () => {
    const err = new Error('Something went wrong')
    expect(parseGateError(err)).toBeNull()
  })

  it('returns null for a non-Error value (string)', () => {
    expect(parseGateError('oops')).toBeNull()
  })

  it('returns null for a non-Error value (plain object)', () => {
    expect(parseGateError({ type: 'portal-access-gate' })).toBeNull()
  })

  it('returns null for null', () => {
    expect(parseGateError(null)).toBeNull()
  })

  it('returns null for a partial gate-shaped object missing required fields', () => {
    const partial = {
      type: 'portal-access-gate',
      // reason missing
      workspaceName: 'Acme',
      logoUrl: null,
      themeStyles: '',
      customCss: '',
      authConfig: { found: true, oauth: {} },
    }
    const err = new Error(JSON.stringify(partial))
    expect(parseGateError(err)).toBeNull()
  })

  it('returns null when type is not portal-access-gate', () => {
    const wrong = { ...VALID_GATE_PAYLOAD, type: 'some-other-error' }
    const err = new Error(JSON.stringify(wrong))
    expect(parseGateError(err)).toBeNull()
  })

  it('returns null when reason is not a recognized value', () => {
    const wrong = { ...VALID_GATE_PAYLOAD, reason: 'blocked' }
    const err = new Error(JSON.stringify(wrong))
    expect(parseGateError(err)).toBeNull()
  })

  it('returns null when authConfig is missing', () => {
    const { authConfig: _, ...noAuth } = VALID_GATE_PAYLOAD
    const err = new Error(JSON.stringify(noAuth))
    expect(parseGateError(err)).toBeNull()
  })

  it('returns null when authConfig.found is not a boolean', () => {
    const wrong = { ...VALID_GATE_PAYLOAD, authConfig: { found: 'yes', oauth: {} } }
    const err = new Error(JSON.stringify(wrong))
    expect(parseGateError(err)).toBeNull()
  })

  it('parses a valid unauthorized gate error', () => {
    const payload: PortalAccessGateErrorShape = {
      ...VALID_GATE_PAYLOAD,
      reason: 'unauthorized',
    }
    const err = new Error(JSON.stringify(payload))
    const result = parseGateError(err)
    expect(result?.reason).toBe('unauthorized')
  })

  it('parses when logoUrl is a non-null string', () => {
    const payload: PortalAccessGateErrorShape = {
      ...VALID_GATE_PAYLOAD,
      logoUrl: 'https://cdn.example.com/logo.png',
    }
    const err = new Error(JSON.stringify(payload))
    const result = parseGateError(err)
    expect(result?.logoUrl).toBe('https://cdn.example.com/logo.png')
  })
})
