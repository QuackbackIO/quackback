import { eq, and, asc, sql } from 'drizzle-orm'
import type { StatusId, WorkspaceId } from '@quackback/ids'
import type { Database } from '../client'
import { postStatuses } from '../schema/statuses'
import type { PostStatusEntity, NewPostStatusEntity, StatusCategory } from '../types'

/**
 * StatusRepository - Data access layer for post statuses
 *
 * This repository provides low-level database operations for post statuses.
 * It does NOT include business logic, validation, or authorization.
 * Use domain services for business rules and validation.
 */
export class StatusRepository {
  constructor(private readonly db: Database) {}

  /**
   * Find a status by ID
   */
  async findById(id: StatusId): Promise<PostStatusEntity | null> {
    const status = await this.db.query.postStatuses.findFirst({
      where: eq(postStatuses.id, id),
    })
    return status ?? null
  }

  /**
   * Find all statuses, ordered by category and position
   */
  async findAll(): Promise<PostStatusEntity[]> {
    return this.db.query.postStatuses.findMany({
      orderBy: [
        // Order by category (active, complete, closed) then position
        sql`CASE
          WHEN ${postStatuses.category} = 'active' THEN 0
          WHEN ${postStatuses.category} = 'complete' THEN 1
          WHEN ${postStatuses.category} = 'closed' THEN 2
        END`,
        asc(postStatuses.position),
      ],
    })
  }

  /**
   * Find the default status (isDefault = true)
   * Returns the first one found if multiple exist
   */
  async findDefault(): Promise<PostStatusEntity | null> {
    const status = await this.db.query.postStatuses.findFirst({
      where: eq(postStatuses.isDefault, true),
    })
    return status ?? null
  }

  /**
   * Find statuses by category
   */
  async findByCategory(category: StatusCategory): Promise<PostStatusEntity[]> {
    return this.db.query.postStatuses.findMany({
      where: eq(postStatuses.category, category),
      orderBy: [asc(postStatuses.position)],
    })
  }

  /**
   * Find a status by slug within an organization
   */
  async findBySlug(organizationId: WorkspaceId, slug: string): Promise<PostStatusEntity | null> {
    const status = await this.db.query.postStatuses.findFirst({
      where: and(eq(postStatuses.workspaceId, organizationId), eq(postStatuses.slug, slug)),
    })
    return status ?? null
  }

  /**
   * Find statuses that should be shown on the roadmap
   */
  async findRoadmapStatuses(): Promise<PostStatusEntity[]> {
    return this.db.query.postStatuses.findMany({
      where: eq(postStatuses.showOnRoadmap, true),
      orderBy: [
        sql`CASE
          WHEN ${postStatuses.category} = 'active' THEN 0
          WHEN ${postStatuses.category} = 'complete' THEN 1
          WHEN ${postStatuses.category} = 'closed' THEN 2
        END`,
        asc(postStatuses.position),
      ],
    })
  }

  /**
   * Create a new status
   */
  async create(data: NewPostStatusEntity): Promise<PostStatusEntity> {
    const [status] = await this.db.insert(postStatuses).values(data).returning()
    return status
  }

  /**
   * Update a status by ID
   */
  async update(
    id: StatusId,
    data: Partial<Omit<PostStatusEntity, 'id' | 'organizationId' | 'createdAt'>>
  ): Promise<PostStatusEntity | null> {
    const [updated] = await this.db
      .update(postStatuses)
      .set(data)
      .where(eq(postStatuses.id, id))
      .returning()

    return updated ?? null
  }

  /**
   * Delete a status by ID
   * Note: Caller should verify no posts are using this status before deletion
   */
  async delete(id: StatusId): Promise<boolean> {
    const result = await this.db.delete(postStatuses).where(eq(postStatuses.id, id)).returning()
    return result.length > 0
  }

  /**
   * Reorder statuses by updating their positions
   * Takes an array of status IDs in the desired order
   */
  async reorder(ids: StatusId[]): Promise<void> {
    // Update each status's position based on its index in the array
    await Promise.all(
      ids.map((id, index) =>
        this.db.update(postStatuses).set({ position: index }).where(eq(postStatuses.id, id))
      )
    )
  }

  /**
   * Set a status as the default for new posts
   * This will unset any other default status in the organization
   */
  async setDefault(organizationId: WorkspaceId, statusId: StatusId): Promise<void> {
    // First, unset all defaults for this organization
    await this.db
      .update(postStatuses)
      .set({ isDefault: false })
      .where(eq(postStatuses.workspaceId, organizationId))

    // Then set the new default
    await this.db
      .update(postStatuses)
      .set({ isDefault: true })
      .where(and(eq(postStatuses.id, statusId), eq(postStatuses.workspaceId, organizationId)))
  }
}
