/**
 * Server functions for portal access: evaluate the caller's access (gate)
 * and update portal access settings (admin only).
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { requireAuth } from './auth-helpers'
import { getPortalConfig, updatePortalConfig } from '@/lib/server/domains/settings/settings.service'
import { actorFromAuth, recordAuditEvent } from '@/lib/server/audit/log'
import {
  evaluatePortalAccess,
  type PortalAccessResult,
} from '@/lib/server/domains/settings/portal-access'
import type { UserId } from '@quackback/ids'

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
      reason: 'public' | 'team' | 'domain' | 'invite' | 'widget'
    }
  | {
      granted: false
      reason: 'unauthenticated' | 'unauthorized'
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
export async function resolvePortalAccessForRequest(): Promise<PortalAccessDecision> {
  const { auth } = await import('@/lib/server/auth/index')
  const { db, principal, eq } = await import('@/lib/server/db')
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

  if (session?.user) {
    userEmail = session.user.email
    emailVerified = session.user.emailVerified

    // Resolve principalType so anonymous Better Auth sessions are not
    // counted as authenticated portal sessions.
    // Fail CLOSED on DB error: treat the session as anonymous so a lookup
    // failure never grants access to a private portal.
    let principalRecord: { type: string; role: string | null } | undefined
    try {
      principalRecord = await db.query.principal.findFirst({
        where: eq(principal.userId, session.user.id as UserId),
        columns: { type: true, role: true },
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
    }
  }

  const isAuthenticated = !!session?.user && !isAnonymousPrincipal

  // Check for an accepted portal invite — only when the caller is a
  // verified authenticated user (both conditions required before hitting DB).
  // Fail CLOSED on DB error: if the lookup fails, assume no invite so a DB
  // outage never grants access to a private portal.
  let hasAcceptedPortalInvite = false
  if (isAuthenticated && emailVerified && userEmail) {
    const { invitation, and: dbAnd, sql: dbSql } = await import('@/lib/server/db')
    try {
      const inviteRow = await db.query.invitation.findFirst({
        where: dbAnd(
          eq(invitation.email, userEmail),
          eq(invitation.kind, 'portal'),
          eq(invitation.status, 'accepted'),
          dbSql`("invitation"."expires_at" IS NULL OR "invitation"."expires_at" > now())`
        ),
        columns: { id: true },
      })
      hasAcceptedPortalInvite = !!inviteRow
    } catch {
      // Invite lookup failed — assume no invite (fail closed).
      hasAcceptedPortalInvite = false
    }
  }

  // Read the full portal config server-side — never leaves this function.
  // A missing/unreadable config must NOT throw: fail open to a public portal
  // so an un-onboarded install keeps working. `getPortalConfig` throws
  // (NotFoundError) when there is no settings row.
  let result: PortalAccessResult
  try {
    const portalConfig = await getPortalConfig()
    result = evaluatePortalAccess({
      visibility: portalConfig.access?.visibility ?? 'public',
      role,
      isAuthenticated,
      userEmail,
      emailVerified,
      allowedDomains: portalConfig.access?.allowedDomains ?? [],
      hasAcceptedPortalInvite,
      widgetSignInEnabled: portalConfig.access?.widgetSignIn ?? false,
    })
  } catch {
    // No settings row / config unreadable — treat the portal as public.
    return { granted: true, reason: 'public' }
  }

  // Return only the decision. Never include allowedDomains, widgetSignIn,
  // or any other policy input — those must stay server-side.
  return { granted: result.granted, reason: result.reason } as PortalAccessDecision
}

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
})

export type UpdatePortalVisibilityInput = z.infer<typeof updatePortalVisibilitySchema>

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

export const updatePortalAccessFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalVisibilitySchema.parse)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    console.log(
      `[fn:portal-access] updatePortalAccessFn: visibility=${data.visibility}, domainCount=${(data.allowedDomains ?? []).length}, widgetSignIn=${data.widgetSignIn}`
    )

    const headers = getRequestHeaders()
    const actor = actorFromAuth(auth)

    const before = await getPortalConfig()

    const normalizedDomains =
      data.allowedDomains !== undefined
        ? normalizeDomains(data.allowedDomains)
        : (before.access?.allowedDomains ?? [])

    const nextWidgetSignIn =
      data.widgetSignIn !== undefined ? data.widgetSignIn : (before.access?.widgetSignIn ?? false)

    const updated = await updatePortalConfig({
      access: {
        visibility: data.visibility,
        allowedDomains: normalizedDomains,
        widgetSignIn: nextWidgetSignIn,
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

    return {
      visibility: updated.access?.visibility ?? 'public',
    }
  })
