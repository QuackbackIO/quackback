import type { ContactId, PrincipalId, UserId, WorkspaceId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { Role } from '@/lib/server/auth'
import { auth } from '@/lib/server/auth'
import { db, session, principal, contactUserLinks, eq, and, gt } from '@/lib/server/db'
import { shouldRollSession, WIDGET_SESSION_TTL_MS } from './widget-session-roll'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'widget-auth' })

export interface WidgetAuthContext {
  settings: {
    id: WorkspaceId
    slug: string
    name: string
  }
  user: {
    id: UserId
    email: string
    name: string
    image: string | null
  }
  principal: {
    id: PrincipalId
    role: Role
    type: string
  }
  /**
   * The CRM contact this widget user is linked to via `contact_user_links`,
   * if any. Populated by `linkContactForWidgetUser` during a verified
   * `POST /api/widget/identify`. Required for ticket list/detail/reply
   * authorisation; null for anonymous or unverified-identify sessions.
   */
  contactId: ContactId | null
}

/**
 * Returns widget auth context from `Authorization: Bearer <token>`, or null if invalid/expired.
 *
 * When called from an extracted API-route handler function, pass the `request`
 * object so headers are read directly instead of relying on TanStack Start's
 * `getRequestHeaders()` async-context (which may not be available in extracted
 * handler references).
 *
 * `roll` extends an active anonymous session's 7-day TTL on use (at most once
 * per 24h, mirroring Better Auth's updateAge) — set it only on the validation-
 * only `/api/widget/session` endpoint, never on per-message hot paths.
 */
export async function getWidgetSession(
  arg?: Request | { request?: Request; roll?: boolean }
): Promise<WidgetAuthContext | null> {
  const request = arg instanceof Request ? arg : arg?.request
  const roll = arg instanceof Request ? false : (arg?.roll ?? false)
  log.debug(`[fn:widget-auth] getWidgetSession`)
  try {
    const headers = request ? request.headers : getRequestHeaders()
    const authHeader = headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) return null

    const rawToken = authHeader.slice(7)
    if (!rawToken) return null

    // better-auth session cookies are formatted as `{token}.{hmac}`. The DB
    // stores only the bare token part. When the widget reuses a portal session
    // cookie (same-origin SSR path) the Bearer value includes the HMAC suffix,
    // so we strip it before querying. Tokens from the identify flow are already
    // bare, so splitting on '.' and taking the first segment is safe for both.
    const token = rawToken.split('.')[0]
    if (!token) return null

    const sessionRecord = await db.query.session.findFirst({
      where: and(eq(session.token, token), gt(session.expiresAt, new Date())),
      with: { user: true },
    })

    if (!sessionRecord?.user) return null

    const userId = sessionRecord.userId as UserId

    const { getSettings } = await import('./workspace')
    const appSettings = await getSettings()
    if (!appSettings) return null

    let principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, userId),
    })

    if (!principalRecord) {
      const [created] = await db
        .insert(principal)
        .values({
          id: generateId('principal'),
          userId,
          role: 'user',
          displayName: sessionRecord.user.name,
          avatarUrl: sessionRecord.user.image ?? null,
          createdAt: new Date(),
        })
        .returning()
      principalRecord = created
    }

    // Resolve linked CRM contact (if any) so callers can authorise on
    // requesterContactId without a second round-trip. A user can in theory
    // have multiple links (rare); the first match is sufficient for
    // ownership predicates that pivot on contactId.
    const contactLink = await db.query.contactUserLinks.findFirst({
      where: eq(contactUserLinks.userId, userId),
    })
    // Roll the session's expiry forward on active use so a returning visitor
    // isn't cut off 7 days after their first mint. Gated to ≥24h since the last
    // touch so rapid reloads don't each write.
    if (roll && shouldRollSession(sessionRecord.updatedAt, Date.now())) {
      const nowDate = new Date()
      await db
        .update(session)
        .set({ expiresAt: new Date(nowDate.getTime() + WIDGET_SESSION_TTL_MS), updatedAt: nowDate })
        .where(eq(session.token, token))
    }

    return {
      settings: {
        id: appSettings.id as WorkspaceId,
        slug: appSettings.slug,
        name: appSettings.name,
      },
      user: {
        id: userId,
        email: sessionRecord.user.email!, // Session users always have email
        name: sessionRecord.user.name,
        image: sessionRecord.user.image ?? null,
      },
      principal: {
        id: principalRecord.id as PrincipalId,
        role: principalRecord.role as Role,
        type: principalRecord.type ?? 'user',
      },
      contactId: (contactLink?.contactId as ContactId | undefined) ?? null,
    }
  } catch (error) {
    log.error({ err: error }, 'get widget session failed')
    throw error
  }
}

/**
 * Fallback auth for widget endpoints: check for a Better Auth session cookie.
 * This covers anonymous users who signed in via the anonymous plugin.
 * Returns a minimal auth context (principalId + type) or null.
 */
export async function getWidgetBetterAuthFallback(
  request: Request
): Promise<{ principalId: PrincipalId; type: string } | null> {
  try {
    const sessionResult = await auth.api.getSession({
      headers: new Headers(request.headers),
    })
    if (!sessionResult?.user) return null

    const userId = sessionResult.user.id as UserId
    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, userId),
    })
    if (!principalRecord) return null

    return {
      principalId: principalRecord.id as PrincipalId,
      type: principalRecord.type,
    }
  } catch {
    return null
  }
}
