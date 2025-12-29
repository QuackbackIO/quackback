/**
 * MemberService - Business logic for members
 *
 * Provides member lookup operations that don't require full ServiceContext.
 */

import { db, eq, sql, member, user } from '@quackback/db'
import type { Member } from '@quackback/db'
import type { MemberId, UserId } from '@quackback/ids'
import { Result, ok, err } from '../shared/result'

export type MemberError = {
  code: 'MEMBER_NOT_FOUND' | 'DATABASE_ERROR'
  message: string
}

/**
 * Team member info with user details
 */
export interface TeamMember {
  id: UserId
  name: string | null
  email: string
  image: string | null
}

export class MemberService {
  /**
   * Find a member by user ID
   *
   * This is a public method that doesn't require ServiceContext since
   * it's a simple lookup operation used during authentication flows.
   */
  async getMemberByUser(userId: UserId): Promise<Result<Member | null, MemberError>> {
    try {
      const foundMember = await db.query.member.findFirst({
        where: eq(member.userId, userId),
      })
      return ok(foundMember ?? null)
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
  async getMemberById(memberId: MemberId): Promise<Result<Member | null, MemberError>> {
    try {
      const foundMember = await db.query.member.findFirst({
        where: eq(member.id, memberId),
      })
      return ok(foundMember ?? null)
    } catch (error) {
      console.error('Error looking up member:', error)
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to lookup member',
      })
    }
  }

  /**
   * List all team members with user details
   *
   * Returns user info (id, name, email, image) for all members.
   * Used for member assignment dropdowns and team lists.
   */
  async listTeamMembers(): Promise<Result<TeamMember[], MemberError>> {
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
   * Count all members (no auth required)
   *
   * Used by getting-started page.
   */
  async countMembers(): Promise<Result<number, MemberError>> {
    try {
      const result = await db.select({ count: sql<number>`count(*)`.as('count') }).from(member)

      return ok(Number(result[0]?.count ?? 0))
    } catch (error) {
      console.error('Error counting members:', error)
      return err({
        code: 'DATABASE_ERROR',
        message: 'Failed to count members',
      })
    }
  }
}

// Singleton instance
export const memberService = new MemberService()
