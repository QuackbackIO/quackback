import type { PrincipalId, UserId, WorkspaceId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { Role } from '@/lib/server/auth'
import { auth } from '@/lib/server/auth'
import { db, session, principal, eq, and, gt } from '@/lib/server/db'
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
}

/**
 * Returns widget auth context from `Authorization: Bearer <token>`, or null if
 * invalid/expired.
 *
 * `roll` extends an active anonymous session's 7-day TTL on use (at most once
 * per 24h, mirroring Better Auth's updateAge) — set it only on the validation-
 * only `/api/widget/session` endpoint, never on per-message hot paths. The raw
 * token lookup is unchanged; the roll is an additive UPDATE after validation, so
 * the proven validation path can't regress.
 */
export async function getWidgetSession(opts?: {
  roll?: boolean
}): Promise<WidgetAuthContext | null> {
  log.debug('get widget session')
  try {
    const headers = getRequestHeaders()
    const authHeader = headers.get('authorization')
    // Bearer is the widget's sole credential — the visitor's localStorage token.
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) || null : null
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

    // Roll the session's expiry forward on active use so a returning visitor
    // isn't cut off 7 days after their first mint. Gated to ≥24h since the last
    // touch so rapid reloads don't each write.
    if (opts?.roll && shouldRollSession(sessionRecord.updatedAt, Date.now())) {
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
