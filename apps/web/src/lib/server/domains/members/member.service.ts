/**
 * MemberService - Business logic for members
 *
 * Provides member lookup operations.
 */

import { db, eq, sql, member, user, type Member } from '@/lib/server/db'
import type { MemberId, UserId } from '@quackback/ids'
import { InternalError, ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import type { TeamMember } from './member.types'

// Re-export types for backwards compatibility
export type { TeamMember } from './member.types'

/**
 * Find a member by user ID
 */
export async function getMemberByUser(userId: UserId): Promise<Member | null> {
  try {
    const foundMember = await db.query.member.findFirst({
      where: eq(member.userId, userId),
    })
    return foundMember ?? null
  } catch (error) {
    console.error('Error looking up member:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to lookup member', error)
  }
}

/**
 * Find a member by ID
 */
export async function getMemberById(memberId: MemberId): Promise<Member | null> {
  try {
    const foundMember = await db.query.member.findFirst({
      where: eq(member.id, memberId),
    })
    return foundMember ?? null
  } catch (error) {
    console.error('Error looking up member:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to lookup member', error)
  }
}

/**
 * List all team members with user details
 */
export async function listTeamMembers(): Promise<TeamMember[]> {
  try {
    const teamMembers = await db
      .select({
        id: member.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: member.role,
        createdAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))

    return teamMembers
  } catch (error) {
    console.error('Error listing team members:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to list team members', error)
  }
}

/**
 * Count all members (no auth required)
 */
export async function countMembers(): Promise<number> {
  try {
    const result = await db.select({ count: sql<number>`count(*)`.as('count') }).from(member)

    return Number(result[0]?.count ?? 0)
  } catch (error) {
    console.error('Error counting members:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to count members', error)
  }
}

/**
 * Update a team member's role
 * @throws ForbiddenError if trying to modify own role
 * @throws ForbiddenError if this would leave no admins
 * @throws NotFoundError if member not found or not a team member
 */
export async function updateMemberRole(
  memberId: MemberId,
  newRole: 'admin' | 'member',
  actingMemberId: MemberId
): Promise<void> {
  // Cannot modify own role
  if (memberId === actingMemberId) {
    throw new ForbiddenError('CANNOT_MODIFY_SELF', 'You cannot change your own role')
  }

  try {
    // Find the target member
    const targetMember = await db.query.member.findFirst({
      where: eq(member.id, memberId),
    })

    if (!targetMember) {
      throw new NotFoundError('MEMBER_NOT_FOUND', 'Team member not found')
    }

    // Ensure target is a team member (admin or member), not a portal user
    if (targetMember.role !== 'admin' && targetMember.role !== 'member') {
      throw new NotFoundError('MEMBER_NOT_FOUND', 'Team member not found')
    }

    // If demoting an admin to member, ensure at least one admin remains
    if (targetMember.role === 'admin' && newRole === 'member') {
      const adminCount = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(member)
        .where(eq(member.role, 'admin'))

      if (Number(adminCount[0]?.count ?? 0) <= 1) {
        throw new ForbiddenError('LAST_ADMIN', 'Cannot demote the last admin')
      }
    }

    // Update the role
    await db.update(member).set({ role: newRole }).where(eq(member.id, memberId))
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw error
    }
    console.error('Error updating member role:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to update member role', error)
  }
}

/**
 * Remove a team member (converts them to a portal user)
 * @throws ForbiddenError if trying to remove self
 * @throws ForbiddenError if this would leave no admins
 * @throws NotFoundError if member not found or not a team member
 */
export async function removeTeamMember(
  memberId: MemberId,
  actingMemberId: MemberId
): Promise<void> {
  // Cannot remove self
  if (memberId === actingMemberId) {
    throw new ForbiddenError('CANNOT_REMOVE_SELF', 'You cannot remove yourself from the team')
  }

  try {
    // Find the target member
    const targetMember = await db.query.member.findFirst({
      where: eq(member.id, memberId),
    })

    if (!targetMember) {
      throw new NotFoundError('MEMBER_NOT_FOUND', 'Team member not found')
    }

    // Ensure target is a team member (admin or member), not a portal user
    if (targetMember.role !== 'admin' && targetMember.role !== 'member') {
      throw new NotFoundError('MEMBER_NOT_FOUND', 'Team member not found')
    }

    // If removing an admin, ensure at least one admin remains
    if (targetMember.role === 'admin') {
      const adminCount = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(member)
        .where(eq(member.role, 'admin'))

      if (Number(adminCount[0]?.count ?? 0) <= 1) {
        throw new ForbiddenError('LAST_ADMIN', 'Cannot remove the last admin')
      }
    }

    // Convert to portal user by setting role to 'user'
    await db.update(member).set({ role: 'user' }).where(eq(member.id, memberId))
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw error
    }
    console.error('Error removing team member:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to remove team member', error)
  }
}
