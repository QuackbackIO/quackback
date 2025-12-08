/**
 * MemberService - Business logic for organization members
 *
 * Provides member lookup operations that don't require full ServiceContext.
 */

import { db, MemberRepository, eq, and, sql, member, user } from '@quackback/db'
import type { Member } from '@quackback/db'
import { Result, ok, err } from '../shared/result'

export type MemberError = {
  code: 'MEMBER_NOT_FOUND' | 'DATABASE_ERROR'
  message: string
}

/**
 * Team member info with user details
 */
export interface TeamMember {
  id: string
  name: string | null
  email: string
  image: string | null
}

export class MemberService {
  /**
   * Find a member by user ID and organization ID
   *
   * This is a public method that doesn't require ServiceContext since
   * it's a simple lookup operation used during authentication flows.
   */
  async getMemberByUserAndOrg(
    userId: string,
    organizationId: string
  ): Promise<Result<Member | null, MemberError>> {
    try {
      const memberRepo = new MemberRepository(db)
      const member = await memberRepo.findByUserAndOrg(userId, organizationId)
      return ok(member)
    } catch (error) {
      console.error('Error looking up member:', error)
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to lookup member',
      })
    }
  }

  /**
   * Find a member by ID
   */
  async getMemberById(memberId: string): Promise<Result<Member | null, MemberError>> {
    try {
      const memberRepo = new MemberRepository(db)
      const foundMember = await memberRepo.findById(memberId)
      return ok(foundMember)
    } catch (error) {
      console.error('Error looking up member:', error)
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to lookup member',
      })
    }
  }

  /**
   * List all team members for an organization with user details
   *
   * Returns user info (id, name, email, image) for all members of the organization.
   * Used for member assignment dropdowns and team lists.
   */
  async listTeamMembers(organizationId: string): Promise<Result<TeamMember[], MemberError>> {
    try {
      const teamMembers = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, organizationId))

      return ok(teamMembers)
    } catch (error) {
      console.error('Error listing team members:', error)
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to list team members',
      })
    }
  }

  /**
   * Count members for an organization (no auth required)
   *
   * Used by getting-started page.
   */
  async countMembersByOrg(organizationId: string): Promise<Result<number, MemberError>> {
    try {
      const result = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(member)
        .where(eq(member.organizationId, organizationId))

      return ok(Number(result[0]?.count ?? 0))
    } catch (error) {
      console.error('Error counting members:', error)
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to count members',
      })
    }
  }

  /**
   * Check if user is a member of organization
   *
   * Returns member record if exists, null otherwise.
   */
  async checkMembership(
    userId: string,
    organizationId: string
  ): Promise<Result<{ isMember: boolean; member?: Member }, MemberError>> {
    try {
      const foundMember = await db.query.member.findFirst({
        where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
      })

      if (foundMember) {
        return ok({ isMember: true, member: foundMember })
      }

      return ok({ isMember: false })
    } catch (error) {
      console.error('Error checking membership:', error)
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to check membership',
      })
    }
  }
}

// Singleton instance
export const memberService = new MemberService()
