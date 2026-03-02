/**
 * PrincipalService - Business logic for principals
 *
 * Provides principal lookup operations.
 */

import { db, eq, and, sql, principal, user, type Principal } from '@/lib/server/db'
import type { ServiceMetadata } from '@/lib/server/db'
import type { PrincipalId, UserId } from '@quackback/ids'
import { InternalError, ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import type { TeamMember } from './principal.types'

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
    console.error('Error looking up principal:', error)
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
    console.error('Error looking up principal:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to lookup principal', error)
  }
}

/**
 * Create a service principal (for API keys or integrations)
 */
export async function createServicePrincipal(params: {
  role: 'admin' | 'member'
  displayName: string
  serviceMetadata: ServiceMetadata
}): Promise<Principal> {
  const [created] = await db
    .insert(principal)
    .values({
      userId: null,
      type: 'service',
      role: params.role,
      displayName: params.displayName,
      serviceMetadata: params.serviceMetadata,
      createdAt: new Date(),
    })
    .returning()

  return created
}

/**
 * Sync profile fields from user table to their principal record.
 * Called when a user changes their name or avatar.
 */
export async function syncPrincipalProfile(
  userId: UserId,
  updates: {
    displayName?: string
    avatarUrl?: string | null
    avatarKey?: string | null
  }
): Promise<void> {
  await db
    .update(principal)
    .set(updates)
    .where(and(eq(principal.userId, userId), eq(principal.type, 'user')))
}

/**
 * List all team members with user details
 */
export async function listTeamMembers(): Promise<TeamMember[]> {
  try {
    const teamMembers = await db
      .select({
        id: principal.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: principal.role,
        createdAt: principal.createdAt,
      })
      .from(principal)
      .innerJoin(user, eq(principal.userId, user.id))
      .where(eq(principal.type, 'user'))

    return teamMembers
  } catch (error) {
    console.error('Error listing team members:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to list team members', error)
  }
}

/**
 * Count all principals (no auth required)
 */
export async function countMembers(): Promise<number> {
  try {
    const result = await db.select({ count: sql<number>`count(*)`.as('count') }).from(principal)

    return Number(result[0]?.count ?? 0)
  } catch (error) {
    console.error('Error counting principals:', error)
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
  actingPrincipalId: PrincipalId
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
    if (targetMember.role === 'admin' && newRole === 'member') {
      const adminCount = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(principal)
        .where(and(eq(principal.role, 'admin'), eq(principal.type, 'user')))

      if (Number(adminCount[0]?.count ?? 0) <= 1) {
        throw new ForbiddenError('LAST_ADMIN', 'Cannot demote the last admin')
      }
    }

    // Update the role
    await db.update(principal).set({ role: newRole }).where(eq(principal.id, principalId))
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw error
    }
    console.error('Error updating principal role:', error)
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
  actingPrincipalId: PrincipalId
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
    if (targetMember.role === 'admin') {
      const adminCount = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(principal)
        .where(and(eq(principal.role, 'admin'), eq(principal.type, 'user')))

      if (Number(adminCount[0]?.count ?? 0) <= 1) {
        throw new ForbiddenError('LAST_ADMIN', 'Cannot remove the last admin')
      }
    }

    // Convert to portal user by setting role to 'user'
    await db.update(principal).set({ role: 'user' }).where(eq(principal.id, principalId))
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw error
    }
    console.error('Error removing team member:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to remove team member', error)
  }
}
