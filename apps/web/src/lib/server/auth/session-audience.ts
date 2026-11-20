/**
 * The audience a Better Auth session is minted for, decided as the row is
 * created (`databaseHooks.session.create.before`).
 *
 * Kept out of `auth/index.ts` so the decision can be driven directly: an
 * inline hook body is reachable only by standing up a whole auth instance.
 */
import { and, db, eq, session } from '@/lib/server/db'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import { logger } from '@/lib/server/logger'
import { headersWorkspaceHost } from '@/lib/server/workspaces/saas-edge-host'
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

/** The current request's headers, or null outside a request. */
function currentRequestHeaders(): HeaderBag | null {
  try {
    return getRequestHeaders()
  } catch {
    return null
  }
}

/**
 * Whether the session is being made on one of the workspace's section hosts
 * (help.acme.com for the help center). Every host the creation can be traced
 * to counts: the library's own request, the headers it was handed, and the
 * request being served. A failed settings read counts as a section host: the
 * cost is a sign-in without team authority, never one with too much.
 */
async function createdOnSectionHost(context: SessionCreateContext): Promise<boolean> {
  const hosts = new Set<string>()
  const add = (headers: HeaderBag | null | undefined) => {
    const host = headers ? headersWorkspaceHost(headers) : null
    if (host) hosts.add(host)
  }
  add(context.request?.headers)
  add(context.headers)
  add(currentRequestHeaders())
  if (hosts.size === 0) return false
  try {
    const { isSectionHost } = await import('@/lib/server/domains/settings/section-links')
    for (const host of hosts) {
      if (await isSectionHost(host)) return true
    }
    return false
  } catch (err) {
    log.error({ err }, 'section hosts not read; the new session is portal scope')
    return true
  }
}

/**
 * The anonymous mint is tagged with its scope and the caller's resolved
 * address. Any other session is a sign-in: portal scope when it is made on a
 * section host, else the column default (dashboard).
 *
 * The admin runs on the primary domain only, and a session cookie is
 * host-only, so a sign-in on a section host never needs team authority. It
 * must not carry it either: a section host's domain can lapse and pass to
 * someone else, who would then receive that cookie. Sessions carried there by
 * the handoff are portal scope for the same reason (section-handoff.ts).
 */
export async function assignSessionScope<T extends Record<string, unknown>>(
  sessionData: T,
  context: SessionCreateContext | null | undefined
): Promise<{ data: T & { scope: SessionScope; ipAddress?: string } } | undefined> {
  if (context?.path === '/sign-in/anonymous') {
    const scope = anonymousSessionScope(context.headers ?? context.request?.headers)
    // The address through getClientIp, which honours only trusted proxy hops,
    // rather than the first forwarding header a client could set. The anonymous
    // vote limit counts these sessions by that address.
    return { data: { ...sessionData, scope, ipAddress: getClientIp(getRequestHeaders()) } }
  }
  if (context && (await createdOnSectionHost(context))) {
    return { data: { ...sessionData, scope: 'portal' } }
  }
  return undefined
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
