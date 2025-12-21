import { eq, and, asc, sql } from 'drizzle-orm'
import type { StatusId, WorkspaceId } from '@quackback/ids'
import { db } from '../tenant-context'
import { postStatuses, DEFAULT_STATUSES } from '../schema/statuses'
import type { PostStatusEntity, NewPostStatusEntity, StatusCategory } from '../types'

/**
 * Get all statuses for an organization, ordered by category and position
 */
export async function getStatusesByOrganization(
  organizationId: WorkspaceId
): Promise<PostStatusEntity[]> {
  return db.query.postStatuses.findMany({
    where: eq(postStatuses.workspaceId, organizationId),
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
 * Get statuses by category for an organization
 */
export async function getStatusesByCategory(
  organizationId: WorkspaceId,
  category: StatusCategory
): Promise<PostStatusEntity[]> {
  return db.query.postStatuses.findMany({
    where: and(eq(postStatuses.workspaceId, organizationId), eq(postStatuses.category, category)),
    orderBy: [asc(postStatuses.position)],
  })
}

/**
 * Get roadmap statuses (showOnRoadmap = true)
 */
export async function getRoadmapStatuses(organizationId: WorkspaceId): Promise<PostStatusEntity[]> {
  return db.query.postStatuses.findMany({
    where: and(eq(postStatuses.workspaceId, organizationId), eq(postStatuses.showOnRoadmap, true)),
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
 * Get a status by ID
 */
export async function getStatusById(id: StatusId): Promise<PostStatusEntity | undefined> {
  return db.query.postStatuses.findFirst({
    where: eq(postStatuses.id, id),
  })
}

/**
 * Get a status by slug within an organization
 */
export async function getStatusBySlug(
  organizationId: WorkspaceId,
  slug: string
): Promise<PostStatusEntity | undefined> {
  return db.query.postStatuses.findFirst({
    where: and(eq(postStatuses.workspaceId, organizationId), eq(postStatuses.slug, slug)),
  })
}

/**
 * Get the default status for new posts in an organization
 */
export async function getDefaultStatus(
  organizationId: WorkspaceId
): Promise<PostStatusEntity | undefined> {
  return db.query.postStatuses.findFirst({
    where: and(eq(postStatuses.workspaceId, organizationId), eq(postStatuses.isDefault, true)),
  })
}

/**
 * Create a new status
 */
export async function createStatus(data: NewPostStatusEntity): Promise<PostStatusEntity> {
  const [status] = await db.insert(postStatuses).values(data).returning()
  return status
}

/**
 * Update a status
 */
export async function updateStatus(
  id: StatusId,
  data: Partial<Omit<NewPostStatusEntity, 'organizationId'>>
): Promise<PostStatusEntity | undefined> {
  const [updated] = await db
    .update(postStatuses)
    .set(data)
    .where(eq(postStatuses.id, id))
    .returning()
  return updated
}

/**
 * Delete a status by ID
 * Note: You should check if any posts use this status before deleting
 */
export async function deleteStatus(id: StatusId): Promise<void> {
  await db.delete(postStatuses).where(eq(postStatuses.id, id))
}

/**
 * Reorder statuses within a category
 * Takes an array of status IDs in the desired order and updates their positions
 */
export async function reorderStatuses(
  organizationId: WorkspaceId,
  category: StatusCategory,
  statusIds: StatusId[]
): Promise<void> {
  // Update each status's position based on its index in the array
  await Promise.all(
    statusIds.map((id, index) =>
      db
        .update(postStatuses)
        .set({ position: index })
        .where(
          and(
            eq(postStatuses.id, id),
            eq(postStatuses.workspaceId, organizationId),
            eq(postStatuses.category, category)
          )
        )
    )
  )
}

/**
 * Set a status as the default for new posts
 * This will unset any other default status in the organization
 */
export async function setDefaultStatus(
  organizationId: WorkspaceId,
  statusId: StatusId
): Promise<void> {
  // First, unset all defaults for this organization
  await db
    .update(postStatuses)
    .set({ isDefault: false })
    .where(eq(postStatuses.workspaceId, organizationId))

  // Then set the new default
  await db
    .update(postStatuses)
    .set({ isDefault: true })
    .where(and(eq(postStatuses.id, statusId), eq(postStatuses.workspaceId, organizationId)))
}

/**
 * Seed default statuses for a new organization
 * Call this when a new organization is created
 */
export async function seedDefaultStatuses(
  organizationId: WorkspaceId
): Promise<PostStatusEntity[]> {
  const statusesToCreate = DEFAULT_STATUSES.map((status) => ({
    ...status,
    workspaceId: organizationId,
  }))

  const inserted = await db.insert(postStatuses).values(statusesToCreate).returning()

  return inserted
}

/**
 * Check if an organization has any statuses
 * Useful to determine if default statuses need to be seeded
 */
export async function hasStatuses(organizationId: WorkspaceId): Promise<boolean> {
  const result = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.workspaceId, organizationId),
    columns: { id: true },
  })
  return !!result
}

/**
 * Get count of posts using a specific status
 * Useful before deleting a status to warn users
 */
export async function getStatusUsageCount(statusId: StatusId): Promise<number> {
  const posts = await import('../schema/posts').then((m) => m.posts)
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(posts)
    .where(eq(posts.statusId, statusId))

  return Number(result[0].count)
}
