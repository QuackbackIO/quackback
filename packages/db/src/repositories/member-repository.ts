import { eq } from 'drizzle-orm'
import type { Database } from '../client'
import { member } from '../schema/auth'
import type { Member } from '../types'
import type { MemberId, UserId } from '@quackback/ids'

/**
 * MemberRepository - Data access layer for organization members
 *
 * This repository provides low-level database operations for members.
 * It does NOT include business logic, validation, or authorization.
 * Use domain services for business rules and validation.
 */
export class MemberRepository {
  constructor(private readonly db: Database) {}

  /**
   * Find a member by ID
   */
  async findById(id: MemberId): Promise<Member | null> {
    const result = await this.db.query.member.findFirst({
      where: eq(member.id, id),
    })
    return result ?? null
  }

  /**
   * Find a member by user ID
   * In single-tenant mode, there's one member record per user.
   */
  async findByUser(userId: UserId): Promise<Member | null> {
    const result = await this.db.query.member.findFirst({
      where: eq(member.userId, userId),
    })
    return result ?? null
  }

  /**
   * Find all members
   */
  async findAll(): Promise<Member[]> {
    return this.db.query.member.findMany()
  }

  /**
   * Find all memberships for a user
   * In single-tenant mode, this returns at most one member record.
   */
  async findByUserId(userId: UserId): Promise<Member[]> {
    return this.db.query.member.findMany({
      where: eq(member.userId, userId),
    })
  }

  /**
   * Update a member's role
   */
  async updateRole(id: MemberId, role: string): Promise<Member | null> {
    const [updated] = await this.db
      .update(member)
      .set({ role })
      .where(eq(member.id, id))
      .returning()

    return updated ?? null
  }
}

// Backwards compatibility alias
export const findByUserAndOrg = (repo: MemberRepository, userId: UserId) => repo.findByUser(userId)
