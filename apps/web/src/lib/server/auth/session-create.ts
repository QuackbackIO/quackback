/**
 * Better Auth `session.create.before` hook.
 *
 * The widget's lazy anonymous mint is the only session scoped to the widget;
 * everything else is a dashboard sign-in. The anonymous mint also records the
 * caller's address through `getClientIp()`, which honours only trusted proxy
 * hops, rather than the first forwarding header a client could set. The
 * anonymous vote limit counts these sessions by that address.
 */
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'

export async function beforeSessionCreate<S extends Record<string, unknown>>(
  sessionData: S,
  context: { path?: string } | null | undefined
): Promise<{ data: S & { scope: 'widget'; ipAddress: string } } | undefined> {
  if (context?.path !== '/sign-in/anonymous') return undefined
  return {
    data: { ...sessionData, scope: 'widget', ipAddress: getClientIp(getRequestHeaders()) },
  }
}
