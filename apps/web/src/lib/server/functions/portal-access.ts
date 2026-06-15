/**
 * Server functions for portal access: evaluate the caller's access (gate)
 * and update portal access settings (admin only).
 */
import { z } from 'zod'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import type { UserId, PrincipalId, SegmentId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'portal-access' })

// ---------------------------------------------------------------------------
// Gate: evaluate the calling request's own access
// ---------------------------------------------------------------------------

/**
 * Evaluate the portal access of the current request's caller.
 *
 * The caller's identity is read entirely server-side from the request
 * headers — a caller cannot supply their own identity or evaluate as
 * someone else.
 *
 * Returns ONLY the access decision: { granted, reason }. The full
 * portal access policy (allowedDomains, widgetSignIn) is never
 * included in the response — this is a public RPC endpoint and
 * returning the allowlist would recreate the exact exposure being
 * fixed here.
 */
export type PortalAccessDecision =
  | {
      granted: true
      reason: 'public' | 'team' | 'domain' | 'invite' | 'widget' | 'segment'
    }
  | {
      granted: false
      reason: 'unauthenticated' | 'unauthorized' | 'suspended'
    }

/**
 * Resolve the portal-access decision for the CURRENT request.
 *
 * This is the shared, reusable core: it reads the caller's session and the
 * portal config entirely server-side, then runs the pure `evaluatePortalAccess`
 * decision function. It is NOT a `createServerFn` — call it directly from any
 * server function or route handler that serves portal content, so the
 * "private portal" gate is enforced at the data layer, not just on the page.
 *
 * The caller's identity is read only from the request headers (cookie session
 * or widget Bearer token) — a caller cannot supply their own identity.
 *
 * Never-throw contract: this function never throws. Two distinct failure modes:
 *
 *   - Portal config unreadable (no settings row, DB error): fail OPEN → treats
 *     the portal as `public`. A fresh un-onboarded install must not have its
 *     public surfaces broken.
 *
 *   - Principal lookup fails (DB error): fail CLOSED → treats the session as
 *     anonymous (isAnonymousPrincipal = true, role = null). A DB error during
 *     principal resolution must never grant access to a private portal.
 */
export const resolvePortalAccessForRequest = createServerOnlyFn(
  async (): Promise<PortalAccessDecision> => {
    // Billing suspension: a suspended/deleting workspace serves NO portal data.
    // This is the shared chokepoint every public read funnels through, so
    // gating here (rather than at each loader) keeps a suspended workspace's
    // content out of the SSR payload entirely — not just hidden behind the
    // root SuspendedView overlay. Reuse ensureNotSuspended (the same guard the
    // write/API paths use — single source of truth for the state) but honour
    // this resolver's never-throw contract by converting its throw into a
    // denial. Any OTHER error (e.g. a settings-read blip) falls through to the
    // normal access eval — fail OPEN so a transient read can't suspend a
    // healthy workspace, matching the resolver's existing config-unreadable
    // philosophy.
    try {
      const { ensureNotSuspended } = await import('@/lib/server/middleware/suspension-guard')
      await ensureNotSuspended()
    } catch (e) {
      const { SuspendedError, DeletingError } =
        await import('@/lib/server/middleware/suspension-guard')
      if (e instanceof SuspendedError || e instanceof DeletingError) {
        return { granted: false, reason: 'suspended' }
      }
    }

    const { auth } = await import('@/lib/server/auth/index')
    const { db, principal, eq } = await import('@/lib/server/db')
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const headers = getRequestHeaders()

    // Resolve the caller's session — no client-supplied identity accepted.
    let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null
    try {
      session = await auth.api.getSession({ headers })
    } catch {
      // No session available; treat as anonymous.
    }

    let role: 'admin' | 'member' | 'user' | null = null
    let userEmail: string | null = null
    let emailVerified = false
    let isAnonymousPrincipal = false
    let resolvedPrincipalId: string | null = null

    if (session?.user) {
      userEmail = session.user.email
      emailVerified = session.user.emailVerified

      // Resolve principalType so anonymous Better Auth sessions are not
      // counted as authenticated portal sessions.
      // Fail CLOSED on DB error: treat the session as anonymous so a lookup
      // failure never grants access to a private portal.
      let principalRecord: { type: string; role: string | null; id: string } | undefined
      try {
        principalRecord = await db.query.principal.findFirst({
          where: eq(principal.userId, session.user.id as UserId),
          columns: { type: true, role: true, id: true },
        })
      } catch {
        // Principal lookup failed — treat caller as anonymous (fail closed).
        isAnonymousPrincipal = true
      }
      if (!isAnonymousPrincipal) {
        if (principalRecord?.type === 'anonymous') {
          isAnonymousPrincipal = true
        }
        role = (principalRecord?.role as 'admin' | 'member' | 'user' | null) ?? null
        resolvedPrincipalId = principalRecord?.id ?? null
      }
    }

    const isAuthenticated = !!session?.user && !isAnonymousPrincipal

    // Check for an accepted portal invite — only when the caller is a
    // verified authenticated user (both conditions required before hitting DB).
    // Fail CLOSED on DB error: if the lookup fails, assume no invite so a DB
    // outage never grants access to a private portal.
    let hasAcceptedPortalInvite = false
    if (isAuthenticated && emailVerified && userEmail) {
      const { invitation, and: dbAnd } = await import('@/lib/server/db')
      // Lowercase the session email before the SQL comparison — the send path
      // always normalizes to lowercase on insert, but an OAuth provider may
      // return a mixed-case address that is stored on the session as-is.
      const normalizedEmail = userEmail.toLowerCase()
      try {
        const inviteRow = await db.query.invitation.findFirst({
          where: dbAnd(
            eq(invitation.email, normalizedEmail),
            eq(invitation.kind, 'portal'),
            // Accepted invites are permanent until revoked — expiry only governs
            // pending invites. Dropping the expires_at check here prevents a
            // user losing access once the invite's pending window passes.
            eq(invitation.status, 'accepted')
          ),
          columns: { id: true },
        })
        hasAcceptedPortalInvite = !!inviteRow
      } catch {
        // Invite lookup failed — assume no invite (fail closed).
        hasAcceptedPortalInvite = false
      }
    }

    // Look up the widget origin marker for the current session.
    // Fail CLOSED on DB error: a lookup failure never grants widget access.
    let hasViaWidgetMarker = false
    if (isAuthenticated && session?.session?.id) {
      const { widgetOriginSession } = await import('@/lib/server/db')
      try {
        const markerRow = await db.query.widgetOriginSession.findFirst({
          where: eq(widgetOriginSession.sessionId, session.session.id),
          columns: { sessionId: true },
        })
        hasViaWidgetMarker = !!markerRow
      } catch {
        // DB error — fail closed (no widget marker).
        hasViaWidgetMarker = false
      }
    }

    // Read the full portal config + widget config server-side — never leaves this function.
    // Two distinct failure modes:
    //   - NotFoundError (no settings row): fresh un-onboarded install, fail
    //     OPEN to a public portal so it keeps working.
    //   - Anything else (DB error, JSON parse, transient infra): fail CLOSED.
    //     A private portal must never silently become public on transient errors.
    let result: { granted: boolean; reason: string }
    try {
      const [{ getPortalConfig }, { getWidgetConfig }, { evaluatePortalAccess }] =
        await Promise.all([
          import('@/lib/server/domains/settings/settings.service'),
          import('@/lib/server/domains/settings/settings.widget'),
          import('@/lib/server/domains/settings/portal-access'),
        ])
      const [portalConfig, widgetConfig] = await Promise.all([
        getPortalConfig(),
        getWidgetConfig().catch(() => null),
      ])
      const identifyVerificationEnabled = widgetConfig?.identifyVerification ?? false

      // Check segment membership — only when authenticated and the config lists allowed segments.
      // Fail CLOSED on DB error: a lookup failure never grants access.
      const allowedSegmentIds = portalConfig.access?.allowedSegmentIds ?? []
      let isInAllowedSegment = false
      if (isAuthenticated && resolvedPrincipalId && allowedSegmentIds.length > 0) {
        try {
          const { segmentIdsForPrincipal } =
            await import('@/lib/server/domains/segments/segment-membership.service')
          const memberSet = await segmentIdsForPrincipal(resolvedPrincipalId as PrincipalId)
          isInAllowedSegment = allowedSegmentIds.some((id) => memberSet.has(id as SegmentId))
        } catch (err) {
          log.warn({ err }, 'segment lookup failed, failing closed')
          isInAllowedSegment = false
        }
      }

      result = evaluatePortalAccess({
        visibility: portalConfig.access?.visibility ?? 'public',
        role,
        isAuthenticated,
        userEmail,
        emailVerified,
        allowedDomains: portalConfig.access?.allowedDomains ?? [],
        hasAcceptedPortalInvite,
        widgetSignInEnabled: portalConfig.access?.widgetSignIn ?? false,
        hasViaWidgetMarker,
        identifyVerificationEnabled,
        isInAllowedSegment,
      })
    } catch (err) {
      const { NotFoundError } = await import('@/lib/shared/errors')
      if (err instanceof NotFoundError) {
        // No settings row — un-onboarded install, treat as public.
        return { granted: true, reason: 'public' }
      }
      // Any other throw (DB error, cache deserialization, etc.) must fail
      // closed. An authenticated visitor gets the unauthorized screen; an
      // anonymous one gets bounced to login.
      log.error({ err }, 'resolve failed, failing closed')
      return {
        granted: false,
        reason: isAuthenticated ? 'unauthorized' : 'unauthenticated',
      }
    }

    // Return only the decision. Never include allowedDomains, widgetSignIn,
    // or any other policy input — those must stay server-side.
    return { granted: result.granted, reason: result.reason } as PortalAccessDecision
  }
)

/**
 * Evaluate the portal access of the current request's caller.
 *
 * Thin `createServerFn` wrapper over `resolvePortalAccessForRequest` so the
 * portal page (`_portal.tsx`) can call it as an RPC. The response carries
 * ONLY the access decision: { granted, reason }. The full portal access
 * policy (allowedDomains, widgetSignIn) is never included in the response.
 */
export const evaluateMyPortalAccessFn = createServerFn({ method: 'GET' }).handler(async () => {
  return resolvePortalAccessForRequest()
})

// ---------------------------------------------------------------------------
// Audit: portal.access.denied (fire-and-forget from _portal.tsx beforeLoad)
// ---------------------------------------------------------------------------

const recordPortalAccessDeniedSchema = z.object({
  reason: z.enum(['unauthenticated', 'unauthorized']),
})

/**
 * Server fn: emit a `portal.access.denied` audit event for an authenticated
 * visitor blocked by the portal gate. Called fire-and-forget from
 * `_portal.tsx`'s `beforeLoad`. Best-effort: any failure is swallowed by
 * `recordAuditEvent` itself; the caller .catch()es to suppress promise
 * rejection so the gate throw isn't affected.
 *
 * Resolves the actor server-side from the request session so the route
 * file doesn't need to import server-only modules (`@tanstack/react-start/server`
 * is rejected by Vite's import-protection plugin in client-bundled code).
 */
export const recordPortalAccessDeniedFn = createServerFn({ method: 'POST' })
  .inputValidator(recordPortalAccessDeniedSchema)
  .handler(async ({ data }) => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { auth } = await import('@/lib/server/auth/index')
    const headers = getRequestHeaders()
    let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null
    try {
      session = await auth.api.getSession({ headers })
    } catch {
      // best-effort
    }
    if (!session?.user) {
      // No authenticated session — nothing to audit (gate-side already filters).
      return
    }
    const { recordAuditEvent } = await import('@/lib/server/audit/log')
    await recordAuditEvent({
      event: 'portal.access.denied',
      outcome: 'failure',
      actor: {
        userId: session.user.id as UserId,
        email: session.user.email,
        type: 'user',
      },
      headers,
      target: { type: 'settings', id: 'portal_config' },
      metadata: { reason: data.reason },
    })
  })

// ---------------------------------------------------------------------------
// Domain normalization helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a single domain string:
 *  - trims whitespace
 *  - lowercases
 *  - strips a leading `@` (e.g. "@acme.com" → "acme.com")
 *
 * Returns `null` when the entry is obviously invalid (no dot, contains `@`
 * after stripping the leading one, contains whitespace, or has a protocol).
 */
function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase()
  if (d.startsWith('@')) d = d.slice(1)

  // Reject protocols
  if (d.includes('://')) return null
  // Must not contain @ (e.g. full email address passed by mistake)
  if (d.includes('@')) return null
  // Must not contain whitespace
  if (/\s/.test(d)) return null
  // Must have at least one dot (otherwise it's not a valid domain)
  if (!d.includes('.')) return null

  return d
}

/**
 * Normalizes and deduplicates a list of domain strings.
 * Invalid entries are silently dropped.
 */
function normalizeDomains(raw: string[]): string[] {
  const seen = new Set<string>()
  for (const entry of raw) {
    const normalized = normalizeDomain(entry)
    if (normalized) seen.add(normalized)
  }
  return Array.from(seen)
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

export const updatePortalVisibilitySchema = z.object({
  visibility: z.enum(['public', 'private']),
  allowedDomains: z.array(z.string()).optional(),
  widgetSignIn: z.boolean().optional(),
  allowedSegmentIds: z.array(z.string()).optional(),
})

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

export const updatePortalAccessFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalVisibilitySchema.parse)
  .handler(async ({ data }) => {
    const [{ requireAuth }, { getRequestHeaders }, { actorFromAuth, recordAuditEvent }] =
      await Promise.all([
        import('./auth-helpers'),
        import('@tanstack/react-start/server'),
        import('@/lib/server/audit/log'),
      ])
    const auth = await requireAuth({ roles: ['admin'] })
    log.debug(
      {
        visibility: data.visibility,
        domain_count: (data.allowedDomains ?? []).length,
        widget_sign_in: data.widgetSignIn,
        segment_count: (data.allowedSegmentIds ?? []).length,
      },
      'update portal access'
    )

    const headers = getRequestHeaders()
    const actor = actorFromAuth(auth)

    const { getPortalConfig, updatePortalConfig } =
      await import('@/lib/server/domains/settings/settings.service')
    const before = await getPortalConfig()

    const normalizedDomains =
      data.allowedDomains !== undefined
        ? normalizeDomains(data.allowedDomains)
        : (before.access?.allowedDomains ?? [])

    const nextWidgetSignIn =
      data.widgetSignIn !== undefined ? data.widgetSignIn : (before.access?.widgetSignIn ?? false)

    // Validate any newly-supplied allowedSegmentIds against the segments
    // table: drop unknown / soft-deleted ids, dedupe. Without this step
    // an admin (or attacker who acquired admin) can store garbage strings
    // in portalConfig.access.allowedSegmentIds — they'd never match a
    // membership at runtime, but the audit log captures the garbage as
    // an "intended change" and the UI re-displays them on the next load.
    let nextSegmentIds: SegmentId[]
    if (data.allowedSegmentIds === undefined) {
      nextSegmentIds = (before.access?.allowedSegmentIds ?? []) as SegmentId[]
    } else if (data.allowedSegmentIds.length === 0) {
      nextSegmentIds = []
    } else {
      const requested = Array.from(new Set(data.allowedSegmentIds))
      const { db, segments: segmentsTable, inArray, isNull, and } = await import('@/lib/server/db')
      const found = await db
        .select({ id: segmentsTable.id })
        .from(segmentsTable)
        .where(
          and(inArray(segmentsTable.id, requested as SegmentId[]), isNull(segmentsTable.deletedAt))
        )
      const valid = new Set(found.map((r) => String(r.id)))
      nextSegmentIds = requested.filter((id) => valid.has(id)) as SegmentId[]
    }

    const updated = await updatePortalConfig({
      access: {
        visibility: data.visibility,
        allowedDomains: normalizedDomains,
        widgetSignIn: nextWidgetSignIn,
        allowedSegmentIds: nextSegmentIds,
      },
    })

    const prevVisibility = before.access?.visibility ?? 'public'
    if (prevVisibility !== data.visibility) {
      await recordAuditEvent({
        event: 'portal.visibility.changed',
        actor,
        headers,
        target: { type: 'settings', id: 'portal-config' },
        before: { visibility: prevVisibility },
        after: { visibility: data.visibility },
      })
    }

    const prevDomains = (before.access?.allowedDomains ?? []).slice().sort()
    const nextDomains = normalizedDomains.slice().sort()
    const domainsChanged =
      prevDomains.length !== nextDomains.length || prevDomains.some((d, i) => d !== nextDomains[i])

    if (data.allowedDomains !== undefined && domainsChanged) {
      await recordAuditEvent({
        event: 'portal.allowed_domains.changed',
        actor,
        headers,
        target: { type: 'settings', id: 'portal-config' },
        before: { allowedDomains: prevDomains },
        after: { allowedDomains: nextDomains },
      })
    }

    const prevWidgetSignIn = before.access?.widgetSignIn ?? false
    if (data.widgetSignIn !== undefined && prevWidgetSignIn !== data.widgetSignIn) {
      await recordAuditEvent({
        event: 'portal.widget_signin.changed',
        actor,
        headers,
        target: { type: 'settings', id: 'portal-config' },
        before: { widgetSignIn: prevWidgetSignIn },
        after: { widgetSignIn: data.widgetSignIn },
      })
    }

    const prevSegmentIds = before.access?.allowedSegmentIds ?? []
    const segmentsChanged =
      JSON.stringify([...prevSegmentIds].sort()) !== JSON.stringify([...nextSegmentIds].sort())
    if (segmentsChanged) {
      await recordAuditEvent({
        event: 'portal.allowed_segments.changed',
        outcome: 'success',
        actor,
        headers,
        before: { allowedSegmentIds: prevSegmentIds },
        after: { allowedSegmentIds: nextSegmentIds },
      })
    }

    return {
      visibility: updated.access?.visibility ?? 'public',
    }
  })
