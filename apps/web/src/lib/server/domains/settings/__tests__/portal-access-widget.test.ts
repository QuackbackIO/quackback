/**
 * Unit tests for the widget grant branch in evaluatePortalAccess().
 *
 * The widget branch now requires FOUR conditions:
 *   1. widgetSignInEnabled — admin opted in.
 *   2. isAuthenticated — real (non-anonymous) session.
 *   3. hasViaWidgetMarker — session was minted by the /auth/widget-handoff route.
 *   4. identifyVerificationEnabled — workspace enforces HMAC-verified widget identity.
 *
 * Pure function — no DB, no mocks needed.
 */
import { describe, it, expect } from 'vitest'
import { evaluatePortalAccess } from '../portal-access'

/** Minimal context that satisfies ALL four widget-grant conditions. */
const FULL_WIDGET_CTX = {
  visibility: 'private' as const,
  role: 'user' as const,
  isAuthenticated: true,
  userEmail: 'user@example.com',
  emailVerified: true,
  allowedDomains: [],
  widgetSignInEnabled: true,
  hasViaWidgetMarker: true,
  identifyVerificationEnabled: true,
}

describe('evaluatePortalAccess — widget sign-in grant (narrowed)', () => {
  it('grants when all four conditions met', () => {
    const result = evaluatePortalAccess(FULL_WIDGET_CTX)
    expect(result.granted).toBe(true)
    if (result.granted) expect(result.reason).toBe('widget')
  })

  // --- widgetSignInEnabled gate ---

  it('denies (unauthorized) when widgetSignIn=false, all other conditions met', () => {
    const result = evaluatePortalAccess({ ...FULL_WIDGET_CTX, widgetSignInEnabled: false })
    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthorized')
  })

  it('defaults widgetSignInEnabled=false when omitted — denies', () => {
    const { widgetSignInEnabled: _, ...rest } = FULL_WIDGET_CTX
    const result = evaluatePortalAccess(rest)
    expect(result.granted).toBe(false)
  })

  // --- isAuthenticated gate ---

  it('denies when not authenticated (unauthenticated reason)', () => {
    const result = evaluatePortalAccess({
      ...FULL_WIDGET_CTX,
      isAuthenticated: false,
    })
    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthenticated')
  })

  // --- hasViaWidgetMarker gate (new) ---

  it('denies when hasViaWidgetMarker=false — self-registered user cannot gain widget grant', () => {
    const result = evaluatePortalAccess({ ...FULL_WIDGET_CTX, hasViaWidgetMarker: false })
    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthorized')
  })

  it('defaults hasViaWidgetMarker=false when omitted — denies', () => {
    const { hasViaWidgetMarker: _, ...rest } = FULL_WIDGET_CTX
    const result = evaluatePortalAccess(rest)
    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthorized')
  })

  // --- identifyVerificationEnabled gate (new) ---

  it('denies when identifyVerificationEnabled=false — email-capture mode not trusted', () => {
    const result = evaluatePortalAccess({
      ...FULL_WIDGET_CTX,
      identifyVerificationEnabled: false,
    })
    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthorized')
  })

  it('defaults identifyVerificationEnabled=false when omitted — denies', () => {
    const { identifyVerificationEnabled: _, ...rest } = FULL_WIDGET_CTX
    const result = evaluatePortalAccess(rest)
    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthorized')
  })

  // --- precedence checks ---

  it('team grant takes precedence over widget (team checked first)', () => {
    const result = evaluatePortalAccess({
      ...FULL_WIDGET_CTX,
      role: 'admin',
    })
    expect(result.granted).toBe(true)
    if (result.granted) expect(result.reason).toBe('team')
  })

  it('domain grant takes precedence over widget (domain checked before widget)', () => {
    const result = evaluatePortalAccess({
      ...FULL_WIDGET_CTX,
      userEmail: 'user@acme.com',
      allowedDomains: ['acme.com'],
    })
    expect(result.granted).toBe(true)
    if (result.granted) expect(result.reason).toBe('domain')
  })

  it('invite grant takes precedence over widget (invite checked before widget)', () => {
    const result = evaluatePortalAccess({
      ...FULL_WIDGET_CTX,
      hasAcceptedPortalInvite: true,
    })
    expect(result.granted).toBe(true)
    if (result.granted) expect(result.reason).toBe('invite')
  })

  // --- public portal ---

  it('public portal is still granted regardless of widget settings', () => {
    const result = evaluatePortalAccess({
      ...FULL_WIDGET_CTX,
      visibility: 'public',
      widgetSignInEnabled: false,
      hasViaWidgetMarker: false,
      identifyVerificationEnabled: false,
    })
    expect(result.granted).toBe(true)
    if (result.granted) expect(result.reason).toBe('public')
  })
})

describe('evaluatePortalAccess — self-registered user security', () => {
  it('self-registered user (no marker) cannot gain widget grant even with all other conditions', () => {
    // Simulates a user who registered via /auth/signup — no widget handoff.
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'self@example.com',
      emailVerified: true,
      allowedDomains: [],
      widgetSignInEnabled: true,
      hasViaWidgetMarker: false, // no marker — did not come through handoff
      identifyVerificationEnabled: true,
    })
    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthorized')
  })

  it('email-capture widget user (identifyVerification off) cannot gain widget grant', () => {
    // Simulates a user who identified via email-capture mode (no HMAC).
    const result = evaluatePortalAccess({
      visibility: 'private',
      role: 'user',
      isAuthenticated: true,
      userEmail: 'captured@example.com',
      emailVerified: true,
      allowedDomains: [],
      widgetSignInEnabled: true,
      hasViaWidgetMarker: true, // came through handoff
      identifyVerificationEnabled: false, // but workspace uses email-capture not HMAC
    })
    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthorized')
  })
})

describe('PortalAccessResult discriminant — widget reason', () => {
  it('reason discriminant narrowing works for widget grant', () => {
    const result = evaluatePortalAccess(FULL_WIDGET_CTX)
    if (result.granted && result.reason === 'widget') {
      const _reason: 'widget' = result.reason
      expect(_reason).toBe('widget')
    }
  })
})
