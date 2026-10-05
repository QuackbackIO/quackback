/**
 * The audience a Better Auth session is minted for, decided as the row is
 * created (`databaseHooks.session.create.before`).
 *
 * Kept out of `auth/index.ts` so the decision can be driven directly: an
 * inline hook body is reachable only by standing up a whole auth instance.
 */
import { SESSION_AUDIENCE_HEADER, type SessionScope } from '@/lib/shared/roles'

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
