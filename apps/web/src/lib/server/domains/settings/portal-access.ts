import type { Role } from '@/lib/shared/roles'
/**
 * Portal-level access evaluation.
 *
 * Decides whether a visitor may render the portal, based on the workspace's
 * configured visibility and the visitor's authentication state.
 *
 * Phase 1: team-only gate (admin | member always pass).
 * Phase 2: allowed email-domain grant (verified email required).
 * Phase 3: accepted portal email-invite grant (verified email required).
 * Phase 4: allowed segment grant (authenticated; emailVerified required to
 *          prevent unverified email-rule matches from granting access).
 * Phase 5: widget sign-in grant (any portal-signed-in user when admin enables widgetSignIn).
 */

// =============================================================================
// Types
// =============================================================================

export type PortalVisibility = 'public' | 'private'

/** Caller-supplied context — everything the evaluator needs, nothing more. */
export interface PortalAccessContext {
  /** Resolved from portalConfig.access?.visibility. Default 'public'. */
  visibility: PortalVisibility
  /**
   * Role of the current principal. `null` means anonymous (no session, or
   * the session's principalType is 'anonymous').
   */
  role: Role | null
  /**
   * True when the visitor has a real (non-anonymous) authenticated session.
   * An anonymous Better Auth session counts as NOT authenticated.
   */
  isAuthenticated: boolean
  /**
   * Email address of the authenticated visitor. `null` when there is no
   * real session. Used for Phase 2 domain-allowlist checks.
   */
  userEmail: string | null
  /**
   * Whether the visitor's email address has been verified. An unverified
   * email must NOT match domain allowlists — anyone could claim an address
   * they don't control without this guard.
   */
  emailVerified: boolean
  /**
   * Domains whose verified users are automatically granted access to a
   * private portal. Resolved from portalConfig.access?.allowedDomains.
   */
  allowedDomains: string[]
  /**
   * True when the visitor has a portal invitation row with status='accepted'
   * whose email matches their verified session email.
   *
   * Populated by the resolver via a DB lookup. Defaults to `false` so callers
   * that don't consult the invite table (e.g. the widget gate, legacy code)
   * remain valid without changes.
   */
  hasAcceptedPortalInvite?: boolean
  /**
   * True when the workspace admin has enabled widget sign-in on this
   * private portal. When set, portal sessions that originated from the
   * widget OTT handoff route gain access (requires both
   * `hasViaWidgetMarker` and `identifyVerificationEnabled`).
   * Defaults to `false`.
   */
  widgetSignInEnabled?: boolean
  /**
   * True when the current session has a row in `widget_origin_session`,
   * meaning it was created via the `/auth/widget-handoff` OTT exchange.
   * Prevents any self-registered portal user from gaining the widget
   * grant without going through the handoff flow. Defaults to `false`.
   */
  hasViaWidgetMarker?: boolean
  /**
   * True when the workspace widget requires HMAC-verified identity
   * (i.e. `identifyVerification=true` in the widget config). When off,
   * anyone who typed an email in the widget becomes "identified" and
   * could mint an OTT — granting portal access in that case would
   * bypass the verified-identity intent. Defaults to `false`.
   */
  identifyVerificationEnabled?: boolean
  /**
   * True when the authenticated visitor is a member of at least one
   * segment the admin has listed in `portalConfig.access.allowedSegmentIds`.
   *
   * Populated by the resolver via a DB lookup against `user_segments`.
   * Defaults to `false` so callers that don't consult the segment table
   * (e.g. legacy code) remain valid without changes.
   *
   * Requires `emailVerified=true` at the evaluator — dynamic segments
   * can predicate on `email` without a verification guard, so an
   * unverified attacker could otherwise enter via an admin-built
   * email-based segment.
   */
  isInAllowedSegment?: boolean
}

/** Discriminated union — narrows cleanly in if/switch. */
export type PortalAccessResult =
  | { granted: true; reason: 'public' | 'team' | 'domain' | 'invite' | 'widget' | 'segment' }
  | { granted: false; reason: 'unauthenticated' | 'unauthorized' }

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extracts the lowercased domain part of an email address.
 * Returns `null` when the input is null or has no `@`.
 */
function emailDomain(email: string | null): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at === -1) return null
  return email.slice(at + 1).toLowerCase()
}

// =============================================================================
// Evaluator
// =============================================================================

/**
 * Pure function — no I/O. Returns a typed access decision.
 *
 * Execution order:
 * 1. Public portal → always granted.
 * 2. Team member (admin | member) → granted.
 * 3. Verified email on allowed-domain list → granted.
 * 4. Accepted portal invite (email match, verified) → granted.
 * 5. Allowed segment grant (authenticated member of an allowed segment) → granted.
 * 6. Widget sign-in: enabled + authenticated + via-widget marker + HMAC mode → granted.
 * 7. No real session → unauthenticated (redirect to login).
 * 8. Authenticated but no matching grant → unauthorized (show access-denied screen).
 *
 * Ordering: team > domain > invite > segment > widget. The widget branch is intentionally
 * last among grant paths so that a more-specific grant (team, domain, invite, segment)
 * is preferred when the user qualifies for multiple paths.
 *
 * Widget branch requires THREE conditions beyond `isAuthenticated`:
 *   - `widgetSignInEnabled` — admin explicitly enabled widget sign-in.
 *   - `hasViaWidgetMarker` — the session was created via the handoff route
 *     (prevents self-registered portal users from gaining the grant).
 *   - `identifyVerificationEnabled` — workspace requires HMAC-verified
 *     widget identity (prevents email-capture mode from granting portal
 *     access, which would bypass the verified-identity intent).
 */
export function evaluatePortalAccess(ctx: PortalAccessContext): PortalAccessResult {
  // 1. Public portal — open to everyone.
  if (ctx.visibility !== 'private') {
    return { granted: true, reason: 'public' }
  }

  // 2. Team members always have access — but only when actually authenticated.
  //    An anonymous principal carrying a team role must not bypass the gate.
  if (ctx.isAuthenticated && (ctx.role === 'admin' || ctx.role === 'member')) {
    return { granted: true, reason: 'team' }
  }

  // 3. Verified email on the domain allowlist.
  //    emailVerified MUST be true — an unverified claim must not unlock access.
  if (ctx.isAuthenticated && ctx.emailVerified && ctx.allowedDomains.length > 0) {
    const domain = emailDomain(ctx.userEmail)
    if (domain && ctx.allowedDomains.includes(domain)) {
      return { granted: true, reason: 'domain' }
    }
  }

  // 4. Accepted portal invite.
  //    emailVerified MUST be true — same reasoning as the domain branch above.
  if (ctx.isAuthenticated && ctx.emailVerified && (ctx.hasAcceptedPortalInvite ?? false)) {
    return { granted: true, reason: 'invite' }
  }

  // 5. Allowed segment grant.
  //    An authenticated user who is a member of any segment the admin has
  //    marked as portal-allowed is granted. emailVerified MUST be true —
  //    dynamic segments can predicate on `email` (eq/contains/ends_with/…)
  //    and the evaluator joins users on `u.email` with no verification
  //    guard. Without this check an attacker who signs up as
  //    `victim@acme.com` and never verifies would walk into a private
  //    portal whose admin configured an `email ends_with @acme.com`
  //    segment in the allowlist. Same rationale as the domain and
  //    invite branches above.
  if (ctx.isAuthenticated && ctx.emailVerified && (ctx.isInAllowedSegment ?? false)) {
    return { granted: true, reason: 'segment' }
  }

  // 6. Widget sign-in grant.
  //    Three guards beyond authentication:
  //      - widgetSignInEnabled: admin opted in.
  //      - hasViaWidgetMarker: session was minted by the handoff route, not by
  //        any other sign-up path. Blocks self-registered users from using this branch.
  //      - identifyVerificationEnabled: workspace enforces HMAC-verified widget
  //        identity. Blocks email-capture (unverified) widget sessions from gaining
  //        portal access — email-capture mode was never meant to imply portal trust.
  if (
    (ctx.widgetSignInEnabled ?? false) &&
    ctx.isAuthenticated &&
    (ctx.hasViaWidgetMarker ?? false) &&
    (ctx.identifyVerificationEnabled ?? false)
  ) {
    return { granted: true, reason: 'widget' }
  }

  // 7. No real authentication → redirect to login.
  if (!ctx.isAuthenticated) {
    return { granted: false, reason: 'unauthenticated' }
  }

  // 8. Authenticated but no matching grant → show access-denied UI.
  return { granted: false, reason: 'unauthorized' }
}
