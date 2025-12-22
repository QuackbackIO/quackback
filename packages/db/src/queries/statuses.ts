import { eq, and, asc, sql } from 'drizzle-orm'
import type { StatusId } from '@quackback/ids'
import { db } from '../client'
import { postStatuses, DEFAULT_STATUSES } from '../schema/statuses'
import type { PostStatusEntity, NewPostStatusEntity, StatusCategory } from '../types'

/**
 * Get all statuses, ordered by category and position
 */
export async function getStatuses(): Promise<PostStatusEntity[]> {
  return db.query.postStatuses.findMany({
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

// Backwards compatibility alias
export const getStatusesByOrganization = getStatuses

/**
 * Get statuses by category
 */
export async function getStatusesByCategory(category: StatusCategory): Promise<PostStatusEntity[]> {
  return db.query.postStatuses.findMany({
    where: eq(postStatuses.category, category),
    orderBy: [asc(postStatuses.position)],
  })
}

/**
 * Get roadmap statuses (showOnRoadmap = true)
 */
export async function getRoadmapStatuses(): Promise<PostStatusEntity[]> {
  return db.query.postStatuses.findMany({
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
 * Get a status by ID
 */
export async function getStatusById(id: StatusId): Promise<PostStatusEntity | undefined> {
  return db.query.postStatuses.findFirst({
    where: eq(postStatuses.id, id),
  })
}

/**
 * Get a status by slug
 */
export async function getStatusBySlug(slug: string): Promise<PostStatusEntity | undefined> {
  return db.query.postStatuses.findFirst({
    where: eq(postStatuses.slug, slug),
  })
}

/**
 * Get the default status for new posts
 */
export async function getDefaultStatus(): Promise<PostStatusEntity | undefined> {
  return db.query.postStatuses.findFirst({
    where: eq(postStatuses.isDefault, true),
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
  data: Partial<Omit<NewPostStatusEntity, 'id'>>
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
  category: StatusCategory,
  statusIds: StatusId[]
): Promise<void> {
  // Update each status's position based on its index in the array
  await Promise.all(
    statusIds.map((id, index) =>
      db
        .update(postStatuses)
        .set({ position: index })
        .where(and(eq(postStatuses.id, id), eq(postStatuses.category, category)))
    )
  )
}

/**
 * Set a status as the default for new posts
 * This will unset any other default status
 */
export async function setDefaultStatus(statusId: StatusId): Promise<void> {
  // First, unset all defaults
  await db.update(postStatuses).set({ isDefault: false })

  // Then set the new default
  await db.update(postStatuses).set({ isDefault: true }).where(eq(postStatuses.id, statusId))
}

/**
 * Seed default statuses for initial setup
 * Call this when the application is first set up
 */
export async function seedDefaultStatuses(): Promise<PostStatusEntity[]> {
  const inserted = await db.insert(postStatuses).values(DEFAULT_STATUSES).returning()
  return inserted
}

/**
 * Check if any statuses exist
 * Useful to determine if default statuses need to be seeded
 */
export async function hasStatuses(): Promise<boolean> {
  const result = await db.query.postStatuses.findFirst({
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
