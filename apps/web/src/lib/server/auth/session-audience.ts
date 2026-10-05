/**
 * The audience a Better Auth session is minted for, decided as the row is
 * created (`databaseHooks.session.create.before`).
 *
 * Kept out of `auth/index.ts` so the decision can be driven directly: an
 * inline hook body is reachable only by standing up a whole auth instance.
 */
import { and, db, eq, session } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { SESSION_AUDIENCE_HEADER, toSessionScope, type SessionScope } from '@/lib/shared/roles'

const log = logger.child({ component: 'session-audience' })

type HeaderBag = { get(name: string): string | null }

export interface SessionCreateContext {
  path?: string
  headers?: HeaderBag
  request?: { headers?: HeaderBag }
}

/**
 * The scope for a fresh anonymous session. Both the portal and the widget mint
 * through `/sign-in/anonymous`; only the portal sends the audience marker, so
 * an unmarked mint (the widget, or any client that says nothing) gets the
 * restrictive widget scope.
 *
 * The marker is client-supplied, and that is safe because it can only choose
 * between the two anonymous tiers. Either way the session belongs to a fresh
 * anonymous principal with role 'user', and portal scope masks team roles and
 * permissions just as widget scope does. A widget client that claims portal
 * gets exactly the session a signed-out portal visitor gets by opening the
 * portal, so it gains nothing it could not already have. Identified widget
 * sessions are minted elsewhere (`/api/widget/identify`) and are always widget.
 */
export function anonymousSessionScope(headers: HeaderBag | undefined): SessionScope {
  return headers?.get(SESSION_AUDIENCE_HEADER) === 'portal' ? 'portal' : 'widget'
}

/**
 * Only the anonymous mint is tagged; every other session-creating path is a
 * sign-in and keeps the column default (dashboard).
 */
export async function assignSessionScope<T extends Record<string, unknown>>(
  sessionData: T,
  context: SessionCreateContext | null | undefined
): Promise<{ data: T & { scope: SessionScope } } | undefined> {
  if (context?.path !== '/sign-in/anonymous') return undefined
  const scope = anonymousSessionScope(context.headers ?? context.request?.headers)
  return { data: { ...sessionData, scope } }
}

/** The anonymous plugin's `isAnonymous` user field is not in the inferred type. */
interface ResolvedSession {
  session: { id: string; scope?: unknown }
  user: object
}

function carriesBearer(headers: HeaderBag): boolean {
  const authz = headers.get('authorization')
  return !!authz && authz.slice(0, 7).toLowerCase() === 'bearer '
}

function carriesSessionCookie(headers: HeaderBag): boolean {
  return /(?:^|;)\s*(?:__Secure-)?better-auth\.session_token=/.test(headers.get('cookie') ?? '')
}

/**
 * A widget-scoped anonymous session that arrives as the site session cookie
 * is a portal visitor's. The widget never holds that cookie: it mints with
 * cookies omitted and presents its token as a Bearer. Retagging such a
 * session as portal grants nothing a portal mint would not (see
 * `anonymousSessionScope`), and an identified widget session never matches
 * because its user is not anonymous.
 */
export function isStrandedPortalSession(found: ResolvedSession, headers: HeaderBag): boolean {
  return (
    toSessionScope(found.session.scope) === 'widget' &&
    (found.user as { isAnonymous?: unknown }).isAnonymous === true &&
    !carriesBearer(headers) &&
    carriesSessionCookie(headers)
  )
}

/**
 * Retag a stranded portal session (see `isStrandedPortalSession`) so the
 * visitor can post, vote and sign in again, and return it with its new scope.
 * Any other session, or a failed write, comes back unchanged.
 */
export async function healStrandedPortalSession<T extends ResolvedSession>(
  found: T,
  headers: HeaderBag
): Promise<T> {
  if (!isStrandedPortalSession(found, headers)) return found
  try {
    await db
      .update(session)
      .set({ scope: 'portal' })
      .where(and(eq(session.id, found.session.id), eq(session.scope, 'widget')))
  } catch (err) {
    log.warn({ err, session_id: found.session.id }, 'portal session retag failed')
    return found
  }
  return { ...found, session: { ...found.session, scope: 'portal' } } as T
}
