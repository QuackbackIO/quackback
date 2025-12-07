import { eq, and } from 'drizzle-orm'
import type { Database } from '../client'
import { member } from '../schema/auth'
import type { Member } from '../types'

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
  async findById(id: string): Promise<Member | null> {
    const result = await this.db.query.member.findFirst({
      where: eq(member.id, id),
    })
    return result ?? null
  }

  /**
   * Find a member by user ID and organization ID
   */
  async findByUserAndOrg(userId: string, organizationId: string): Promise<Member | null> {
    const result = await this.db.query.member.findFirst({
      where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    })
    return result ?? null
  }

  /**
   * Find all members for an organization
   */
  async findByOrganization(organizationId: string): Promise<Member[]> {
    return this.db.query.member.findMany({
      where: eq(member.organizationId, organizationId),
    })
  }

  /**
   * Find all memberships for a user
   */
  async findByUserId(userId: string): Promise<Member[]> {
    return this.db.query.member.findMany({
      where: eq(member.userId, userId),
    })
  }

  /**
   * Update a member's role
   */
  async updateRole(id: string, role: string): Promise<Member | null> {
    const [updated] = await this.db
      .update(member)
      .set({ role })
      .where(eq(member.id, id))
      .returning()

    return updated ?? null
  }
}
