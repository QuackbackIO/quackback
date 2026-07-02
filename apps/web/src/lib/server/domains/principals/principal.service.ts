/**
 * PrincipalService - Business logic for principals
 *
 * Provides principal lookup operations.
 */

import {
  db,
  eq,
  ne,
  and,
  or,
  sql,
  ilike,
  max,
  principal,
  session,
  user,
  type Principal,
} from '@/lib/server/db'
import type { PrincipalId, UserId } from '@quackback/ids'
import { InternalError, ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { isTeamMember, isAdmin } from '@/lib/shared/roles'
import { recordAuditEvent, type AuditActor } from '@/lib/server/audit/log'
import type { TeamMember } from './principal.types'
import { logger } from '@/lib/server/logger'
import { setPrincipalRole } from './principal.factory'

const log = logger.child({ component: 'principals' })

// Re-export types for backwards compatibility
export type { TeamMember } from './principal.types'

/**
 * Find a principal by user ID
 */
export async function getMemberByUser(userId: UserId): Promise<Principal | null> {
  try {
    const foundMember = await db.query.principal.findFirst({
      where: eq(principal.userId, userId),
    })
    return foundMember ?? null
  } catch (error) {
    log.error({ err: error }, 'principal lookup failed')
    throw new InternalError('DATABASE_ERROR', 'Failed to lookup principal', error)
  }
}

/**
 * Find a principal by ID
 */
export async function getMemberById(principalId: PrincipalId): Promise<Principal | null> {
  try {
    const foundMember = await db.query.principal.findFirst({
      where: eq(principal.id, principalId),
    })
    return foundMember ?? null
  } catch (error) {
    log.error({ err: error }, 'principal lookup failed')
    throw new InternalError('DATABASE_ERROR', 'Failed to lookup principal', error)
  }
}

/**
 * Principal creation, the role writer, and the profile-sync helpers now live in
 * the principal factory — the single owner of principal inserts and role writes.
 * Re-exported here so existing importers are unchanged.
 */
export {
  createServicePrincipal,
  syncPrincipalProfile,
  syncPrincipalProfileById,
} from './principal.factory'

/**
 * List all team members with user details
 *
 * `lastSignInAt` is computed as `max(session.created_at)` per user
 * via a left-join subquery so the admin team list can show a
 * "last sign-in" column without a second round-trip. Users with no
 * sessions show `null` (never signed in or all sessions pruned).
 */
export async function listTeamMembers(): Promise<TeamMember[]> {
  try {
    // Subquery: latest session timestamp per user. Left-joined so
    // users without sessions still appear in the result with null.
    const lastSession = db
      .select({
        userId: session.userId,
        lastSignInAt: max(session.createdAt).as('last_sign_in_at'),
      })
      .from(session)
      .groupBy(session.userId)
      .as('last_session')

    const rawMembers = await db
      .select({
        id: principal.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: principal.role,
        createdAt: principal.createdAt,
        lastSignInAt: sql<Date | string | null>`${lastSession.lastSignInAt}`,
      })
      .from(principal)
      .innerJoin(user, eq(principal.userId, user.id))
      .leftJoin(lastSession, eq(lastSession.userId, user.id))
      // Teammates only: an identified human (type='user') with a teammate role
      // (admin or member, i.e. role != 'user'). Without the role guard a portal
      // end-user (role='user', type='user') leaks into the team roster.
      .where(and(eq(principal.type, 'user'), ne(principal.role, 'user')))

    // The `max()` aggregate comes back as a string from postgres-js
    // (Date mapping only fires on plain timestamp column selects);
    // normalise to Date for the TeamMember type. Different shape from
    // the server-fn boundary (which wants string), so we use a Date
    // constructor directly rather than going through toIsoStringOrNull.
    return rawMembers.map((m) => ({
      ...m,
      lastSignInAt: m.lastSignInAt == null ? null : new Date(m.lastSignInAt),
    }))
  } catch (error) {
    log.error({ err: error }, 'failed to list team members')
    throw new InternalError('DATABASE_ERROR', 'Failed to list team members', error)
  }
}

/**
 * Public-safe teammate avatars for the widget Home header: name + image only,
 * nothing else leaves the server. Same teammate predicate as listTeamMembers
 * (identified human + teammate role) so portal end-users, anonymous visitors,
 * and service principals can never appear. Members with a real avatar image
 * sort first so the cluster shows faces over initials.
 */
export async function listTeamAvatars(
  limit = 3
): Promise<{ name: string; avatarUrl: string | null }[]> {
  try {
    const rows = await db
      .select({ name: user.name, avatarUrl: user.image })
      .from(principal)
      .innerJoin(user, eq(principal.userId, user.id))
      .where(and(eq(principal.type, 'user'), ne(principal.role, 'user')))
      .orderBy(sql`(${user.image} IS NOT NULL) DESC`, principal.createdAt)
      .limit(limit)
    return rows
  } catch (error) {
    log.error({ err: error }, 'failed to list team avatars')
    throw new InternalError('DATABASE_ERROR', 'Failed to list team avatars', error)
  }
}

/**
 * Search members (all human principals) by name or email.
 * Returns a limited result set for use in typeahead/combobox components.
 */
export async function searchMembers(params: {
  search?: string
  limit?: number
}): Promise<TeamMember[]> {
  const limit = Math.min(params.limit ?? 20, 50)
  const conditions = [eq(principal.type, 'user')]

  if (params.search?.trim()) {
    const q = `%${params.search.trim()}%`
    conditions.push(or(ilike(user.name, q), ilike(user.email, q))!)
  }

  return db
    .select({
      id: principal.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: principal.role,
      createdAt: principal.createdAt,
      // searchMembers is the typeahead path — never displays
      // last-sign-in, so a null literal is cheaper than the
      // group-by needed in listTeamMembers.
      lastSignInAt: sql<Date | null>`NULL::timestamptz`,
    })
    .from(principal)
    .innerJoin(user, eq(principal.userId, user.id))
    .where(and(...conditions))
    .orderBy(user.name)
    .limit(limit)
}

/**
 * Count all principals excluding anonymous voters (no auth required)
 */
export async function countMembers(): Promise<number> {
  try {
    const result = await db
      .select({ count: sql<number>`count(*)`.as('count') })
      .from(principal)
      .where(ne(principal.type, 'anonymous'))

    return Number(result[0]?.count ?? 0)
  } catch (error) {
    log.error({ err: error }, 'failed to count principals')
    throw new InternalError('DATABASE_ERROR', 'Failed to count principals', error)
  }
}

/**
 * Update a team member's role
 * @throws ForbiddenError if trying to modify own role
 * @throws ForbiddenError if this would leave no admins
 * @throws NotFoundError if principal not found or not a team member
 */
export async function updateMemberRole(
  principalId: PrincipalId,
  newRole: 'admin' | 'member',
  actingPrincipalId: PrincipalId,
  actor: AuditActor | null = null,
  headers?: Headers
): Promise<void> {
  // Cannot modify own role
  if (principalId === actingPrincipalId) {
    throw new ForbiddenError('CANNOT_MODIFY_SELF', 'You cannot change your own role')
  }

  try {
    // Find the target principal
    const targetMember = await db.query.principal.findFirst({
      where: eq(principal.id, principalId),
    })

    if (!targetMember) {
      throw new NotFoundError('MEMBER_NOT_FOUND', 'Team member not found')
    }

    // Ensure target is a team member (admin or member), not a portal user
    if (!isTeamMember(targetMember.role)) {
      throw new NotFoundError('MEMBER_NOT_FOUND', 'Team member not found')
    }

    // If demoting an admin to member, ensure at least one human admin remains
    if (isAdmin(targetMember.role) && newRole === 'member') {
      const adminCount = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(principal)
        .where(and(eq(principal.role, 'admin'), eq(principal.type, 'user')))

      if (Number(adminCount[0]?.count ?? 0) <= 1) {
        throw new ForbiddenError('LAST_ADMIN', 'Cannot demote the last admin')
      }
    }

    const previousRole = targetMember.role

    // Update the role (the factory busts PRINCIPAL_BY_USER from the row's userId)
    await setPrincipalRole({ principalId }, newRole, { knownUserId: targetMember.userId })

    // Audit the role change. Already audited from the SSO/JIT path
    // (`auth/hooks.ts` emits user.role.changed there). Admin manual
    // role flips need the same coverage or the audit log doesn't tell
    // the full story of who got which role.
    if (actor) {
      await recordAuditEvent({
        event: 'user.role.changed',
        actor,
        headers,
        target: { type: 'principal', id: principalId },
        before: { role: previousRole },
        after: { role: newRole },
      })
    }
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw error
    }
    log.error({ err: error }, 'failed to update principal role')
    throw new InternalError('DATABASE_ERROR', 'Failed to update principal role', error)
  }
}

/**
 * Remove a team member (converts them to a portal user)
 * @throws ForbiddenError if trying to remove self
 * @throws ForbiddenError if this would leave no admins
 * @throws NotFoundError if principal not found or not a team member
 */
export async function removeTeamMember(
  principalId: PrincipalId,
  actingPrincipalId: PrincipalId,
  actor: AuditActor | null = null,
  headers?: Headers
): Promise<void> {
  // Cannot remove self
  if (principalId === actingPrincipalId) {
    throw new ForbiddenError('CANNOT_REMOVE_SELF', 'You cannot remove yourself from the team')
  }

  try {
    // Find the target principal
    const targetMember = await db.query.principal.findFirst({
      where: eq(principal.id, principalId),
    })

    if (!targetMember) {
      throw new NotFoundError('MEMBER_NOT_FOUND', 'Team member not found')
    }

    // Ensure target is a team member (admin or member), not a portal user
    if (!isTeamMember(targetMember.role)) {
      throw new NotFoundError('MEMBER_NOT_FOUND', 'Team member not found')
    }

    // If removing an admin, ensure at least one human admin remains
    if (isAdmin(targetMember.role)) {
      const adminCount = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(principal)
        .where(and(eq(principal.role, 'admin'), eq(principal.type, 'user')))

      if (Number(adminCount[0]?.count ?? 0) <= 1) {
        throw new ForbiddenError('LAST_ADMIN', 'Cannot remove the last admin')
      }
    }

    const previousRole = targetMember.role

    // Convert to portal user by setting role to 'user'
    await setPrincipalRole({ principalId }, 'user', { knownUserId: targetMember.userId })

    // Audit the removal. The audit-event taxonomy already reserves
    // `user.removed` for this exact action (audit/log.ts); without an
    // emission the event was a dead literal and the team can't see
    // who lost which role.
    if (actor) {
      await recordAuditEvent({
        event: 'user.removed',
        actor,
        headers,
        target: { type: 'principal', id: principalId },
        before: { role: previousRole },
        after: { role: 'user' },
      })
    }
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw error
    }
    log.error({ err: error }, 'failed to remove team member')
    throw new InternalError('DATABASE_ERROR', 'Failed to remove team member', error)
  }
}
