/**
 * "Require two-factor authentication", on the server.
 *
 * The setting reads "Users must enter a code from their authenticator app after
 * their password." For a person who has enrolled, the two-factor plugin already
 * holds the session back until the code. For one who has not, the sign-in
 * dialog walked them through enrolment, but a direct `/sign-in/email` got a
 * full session and nothing on the server stopped it.
 *
 * Refusing that sign-in outright would leave no way to enrol: enrolment
 * (`/two-factor/enable`, then `/two-factor/verify-totp`) needs a session. So a
 * password sign-in or sign-up issued while the requirement is on and the person
 * is not enrolled gets a session marked `twoFactorPending`, decided once, at
 * issuance:
 *
 *  - it can finish enrolment and sign out, and nothing else:
 *    {@link TWO_FACTOR_PENDING_ALLOWLIST} in the Better Auth before-hook;
 *  - every session read treats it as no session: `/get-session` (HTTP and
 *    in-process `auth.api.getSession`) answers null, and so does
 *    `getRequestSession`;
 *  - finishing enrolment replaces it: `verify-totp` creates a new session,
 *    whose additional fields take their defaults, so it is an ordinary one.
 *
 * Marking at issuance rather than deciding at read time keeps the rule to
 * password sign-ins, which is what the setting says: an admin who turns it on
 * is not locked out of the session they are using, and single sign-on and
 * email-link sessions are untouched.
 */
import type { UserId } from '@quackback/ids'

/** The paths whose sessions follow a password, the ones the setting governs. */
const PASSWORD_SESSION_PATHS = new Set(['/sign-in/email', '/sign-up/email'])

/**
 * The Better Auth paths a pending session may call, besides starting a sign-in
 * afresh (every path `inferProvider` names, in `hooks.ts`: none of them acts on
 * the session the caller already holds, and a person who walked away from
 * enrolment must be able to sign in again).
 *
 * `/get-session` answers null for it (see `hooks.ts`), so it is safe to let
 * through; the two enrolment endpoints read the session through the library's
 * own session middleware, which those hooks do not touch. The rest take no
 * session at all: resetting a forgotten password, and the second-factor
 * challenge an enrolled person meets after their password.
 */
export const TWO_FACTOR_PENDING_ALLOWLIST: ReadonlySet<string> = new Set([
  '/get-session',
  '/sign-out',
  '/two-factor/enable',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/request-password-reset',
  '/reset-password',
  '/reset-password/:token',
])

/** Whether a session (as Better Auth stores or returns it) is pending enrolment. */
export function isTwoFactorPendingSession(session: unknown): boolean {
  return (
    typeof session === 'object' &&
    session !== null &&
    (session as { twoFactorPending?: unknown }).twoFactorPending === true
  )
}

/**
 * Whether the session about to be created must be pending: a password sign-in
 * or sign-up, the workspace requires two-factor, and the person has not
 * enrolled. Runs in `databaseHooks.session.create.before`.
 */
export async function shouldIssuePendingSession(
  sessionData: { userId?: unknown },
  context: { path?: string } | null | undefined
): Promise<boolean> {
  if (!PASSWORD_SESSION_PATHS.has(context?.path ?? '')) return false
  if (typeof sessionData.userId !== 'string') return false
  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const workspace = await getWorkspaceSettings()
  if (workspace?.authConfig?.twoFactor?.required !== true) return false
  const { db, user, eq } = await import('@/lib/server/db')
  const row = await db.query.user.findFirst({
    where: eq(user.id, sessionData.userId as UserId),
    columns: { twoFactorEnabled: true },
  })
  return row?.twoFactorEnabled !== true
}
