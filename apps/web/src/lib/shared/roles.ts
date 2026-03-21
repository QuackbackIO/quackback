/**
 * Role check helpers
 *
 * Shared between client and server code to eliminate inlined role checks
 * like `['admin', 'member'].includes(role)` scattered across the codebase.
 */

/** Roles used throughout the application. */
export type Role = 'admin' | 'member' | 'user'

/** Returns true if the role is 'admin' or 'member' (i.e. a team member, not a portal user). */
export function isTeamMember(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'member'
}

/** Returns true if the role is 'admin'. */
export function isAdmin(role: string | null | undefined): boolean {
  return role === 'admin'
}
