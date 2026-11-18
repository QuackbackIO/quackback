/**
 * The auth-denial error vocabulary and its matcher, as a pure leaf module with
 * no import graph beyond one shared constant. `requireAuth` / `assertPermission`
 * (auth-helpers.ts) throw plain Errors in this vocabulary — no typed error
 * class exists at that seam — so callers that map a denial onto their own
 * error shape discriminate on the messages. Extracted from auth-helpers.ts so
 * a consumer (or a test) can reach the REAL matcher without pulling in the
 * auth stack that auth-helpers itself imports; auth-helpers re-exports it, so
 * the vocabulary still lives beside the throws for existing importers.
 */

import { SEAT_PAUSED_DENIAL } from '@/lib/shared/billing/seat-paused'

/**
 * Whether an error is the denial half of `requireAuth`'s throw vocabulary
 * ('Authentication required', 'Access denied: …', and the paused-seat
 * refusal, `SEAT_PAUSED_DENIAL`). Deliberately excludes
 * 'Workspace not configured': that is a server-side misconfiguration, not
 * something the caller's credentials can fix, so it belongs with the
 * rethrown 500s.
 */
export function isAuthDenialError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.startsWith('Authentication required') ||
      err.message.startsWith('Access denied') ||
      err.message.startsWith(SEAT_PAUSED_DENIAL))
  )
}

/**
 * Whether an error is `requireAuth`'s refusal of a signed-in caller ('Access
 * denied: …': a missing permission, a non-team principal, a widget or portal
 * session). Unlike `isAuthDenialError` it leaves out 'Authentication
 * required', so a signed-out caller still reads as signed out.
 */
export function isAccessDeniedError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Access denied')
}
