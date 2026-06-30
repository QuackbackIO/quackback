/**
 * Role and principal-type definitions plus the predicates that distinguish a
 * teammate from an end-user.
 *
 * Single source of truth, shared between client and server, so these checks are
 * never re-inlined (e.g. `['admin', 'member'].includes(role)`) across the
 * codebase. Keep this module dependency-free and client-safe.
 *
 * The product runs two kinds of actor on one principal: teammates who operate
 * the workspace (role 'admin' or 'member') and end-users who use the portal
 * (role 'user'). `type` further separates an identified human ('user') from an
 * anonymous visitor ('anonymous') and a machine ('service'). The two axes share
 * one row, so "is this a teammate?" and "is this an end-user?" must be answered
 * the same way everywhere.
 */

/** Teammate/end-user tier carried on a principal. */
export type Role = 'admin' | 'member' | 'user'

/** What kind of actor a principal is. */
export type PrincipalType = 'user' | 'anonymous' | 'service'

/** Role privilege order, low to high. Used to compare/escalate roles. */
export const ROLE_RANK: Record<Role, number> = { user: 0, member: 1, admin: 2 }

/** True when role `a` is at least as privileged as role `b`. */
export function roleAtLeast(a: Role, b: Role): boolean {
  return ROLE_RANK[a] >= ROLE_RANK[b]
}

/** True for a teammate tier ('admin' or 'member'), i.e. not a portal end-user. */
export function isTeamMember(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'member'
}

/** True for the 'admin' tier. */
export function isAdmin(role: string | null | undefined): boolean {
  return role === 'admin'
}

/** True for the end-user (portal) tier. The role half of the People axis. */
export function isEndUser(role: string | null | undefined): boolean {
  return role === 'user'
}

/** True for an identified human principal (not an anonymous visitor or a machine). */
export function isIdentifiedHuman(type: string | null | undefined): boolean {
  return type === 'user'
}
