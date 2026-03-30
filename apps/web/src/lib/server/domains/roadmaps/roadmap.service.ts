/**
 * RoadmapService - Business logic for roadmap operations
 *
 * This service handles all roadmap-related business logic including:
 * - Roadmap CRUD operations
 * - Post assignment to roadmaps
 * - Post ordering within roadmap columns
 * - Validation
 */

import {
  db,
  eq,
  and,
  isNull,
  asc,
  sql,
  roadmaps,
  posts,
  postRoadmaps,
  type Roadmap,
} from '@/lib/server/db'
import { toUuid, type RoadmapId, type PostId, type PrincipalId } from '@featurepool/ids'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import type {
  CreateRoadmapInput,
  UpdateRoadmapInput,
  AddPostToRoadmapInput,
  ReorderPostsInput,
} from './roadmap.types'

// ==========================================================================
// ROADMAP CRUD
// ==========================================================================

/**
 * Create a new roadmap
 */
export async function createRoadmap(input: CreateRoadmapInput): Promise<Roadmap> {
  console.log(`[domain:roadmaps] createRoadmap: slug=${input.slug}`)
  // Validate input
  if (!input.name?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Name is required')
  }
  if (!input.slug?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Slug is required')
  }
  if (input.name.length > 100) {
    throw new ValidationError('VALIDATION_ERROR', 'Name must be 100 characters or less')
  }
  if (!/^[a-z0-9-]+$/.test(input.slug)) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Slug must contain only lowercase letters, numbers, and hyphens'
    )
  }

  // Check for duplicate slug (outside transaction)
  const existing = await db.query.roadmaps.findFirst({
    where: eq(roadmaps.slug, input.slug),
  })
  if (existing) {
    throw new ConflictError('DUPLICATE_SLUG', `A roadmap with slug "${input.slug}" already exists`)
  }

  // Get next position (outside transaction)
  const positionResult = await db
    .select({ maxPosition: sql<number>`COALESCE(MAX(${roadmaps.position}), -1)` })
    .from(roadmaps)
  const position = (positionResult[0]?.maxPosition ?? -1) + 1

  // Create the roadmap (single insert, no transaction needed)
  const [roadmap] = await db
    .insert(roadmaps)
    .values({
      name: input.name.trim(),
      slug: input.slug.trim(),
      description: input.description?.trim() || null,
      isPublic: input.isPublic ?? true,
      position,
    })
    .returning()

  return roadmap
}

/**
 * Update an existing roadmap
 */
export async function updateRoadmap(id: RoadmapId, input: UpdateRoadmapInput): Promise<Roadmap> {
  console.log(`[domain:roadmaps] updateRoadmap: id=${id}`)
  // Validate input
  if (input.name !== undefined && !input.name.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Name cannot be empty')
  }
  if (input.name && input.name.length > 100) {
    throw new ValidationError('VALIDATION_ERROR', 'Name must be 100 characters or less')
  }

  // Build update data
  const updateData: Partial<Omit<Roadmap, 'id' | 'createdAt'>> = {}
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.description !== undefined) updateData.description = input.description?.trim() || null
  if (input.isPublic !== undefined) updateData.isPublic = input.isPublic

  // Update the roadmap (single update, no transaction needed)
  const [updated] = await db.update(roadmaps).set(updateData).where(eq(roadmaps.id, id)).returning()

  if (!updated) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
  }

  return updated
}

/**
 * Soft delete a roadmap
 *
 * Sets deletedAt timestamp instead of removing the row.
 */
export async function deleteRoadmap(id: RoadmapId): Promise<void> {
  console.log(`[domain:roadmaps] deleteRoadmap: id=${id}`)
  const result = await db
    .update(roadmaps)
    .set({ deletedAt: new Date() })
    .where(and(eq(roadmaps.id, id), isNull(roadmaps.deletedAt)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
  }
}

/**
 * Get a roadmap by ID
 */
export async function getRoadmap(id: RoadmapId): Promise<Roadmap> {
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, id) })

  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
  }

  return roadmap
}

/**
 * Get a roadmap by slug
 */
export async function getRoadmapBySlug(slug: string): Promise<Roadmap> {
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.slug, slug) })

  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with slug "${slug}" not found`)
  }

  return roadmap
}

/**
 * List all roadmaps (admin view, excludes soft-deleted)
 */
export async function listRoadmaps(): Promise<Roadmap[]> {
  return db.query.roadmaps.findMany({
    where: isNull(roadmaps.deletedAt),
    orderBy: [asc(roadmaps.position)],
  })
}

/**
 * List public roadmaps (for portal view, excludes soft-deleted)
 */
export async function listPublicRoadmaps(): Promise<Roadmap[]> {
  return db.query.roadmaps.findMany({
    where: and(eq(roadmaps.isPublic, true), isNull(roadmaps.deletedAt)),
    orderBy: [asc(roadmaps.position)],
  })
}

/**
 * Reorder roadmaps in the sidebar
 * Uses a single batch UPDATE with CASE WHEN for efficiency
 */
export async function reorderRoadmaps(roadmapIds: RoadmapId[]): Promise<void> {
  console.log(`[domain:roadmaps] reorderRoadmaps: count=${roadmapIds.length}`)
  if (roadmapIds.length === 0) return

  // Build CASE WHEN clause for batch update
  const cases = roadmapIds
    .map((id, i) => sql`WHEN id = ${toUuid(id)} THEN ${i}`)
    .reduce((acc, curr) => sql`${acc} ${curr}`, sql``)
  const ids = roadmapIds.map((id) => toUuid(id))

  // Single UPDATE with CASE expression
  await db.execute(sql`
    UPDATE roadmaps
    SET position = CASE ${cases} END
    WHERE id = ANY(${ids}::uuid[])
  `)
}

// ==========================================================================
// POST MANAGEMENT
// ==========================================================================

/**
 * Add a post to a roadmap
 */
export async function addPostToRoadmap(
  input: AddPostToRoadmapInput,
  actorPrincipalId?: PrincipalId
): Promise<void> {
  console.log(
    `[domain:roadmaps] addPostToRoadmap: postId=${input.postId}, roadmapId=${input.roadmapId}`
  )
  // Verify roadmap exists
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, input.roadmapId) })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${input.roadmapId} not found`)
  }

  // Verify post exists
  const post = await db.query.posts.findFirst({ where: eq(posts.id, input.postId) })
  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${input.postId} not found`)
  }

  // Check if post is already in roadmap
  const existingEntry = await db.query.postRoadmaps.findFirst({
    where: and(eq(postRoadmaps.postId, input.postId), eq(postRoadmaps.roadmapId, input.roadmapId)),
  })
  if (existingEntry) {
    throw new ConflictError(
      'POST_ALREADY_IN_ROADMAP',
      `Post ${input.postId} is already in roadmap ${input.roadmapId}`
    )
  }

  // Get next position in the roadmap
  const positionResult = await db
    .select({ maxPosition: sql<number>`COALESCE(MAX(${postRoadmaps.position}), -1)` })
    .from(postRoadmaps)
    .where(eq(postRoadmaps.roadmapId, input.roadmapId))
  const position = (positionResult[0]?.maxPosition ?? -1) + 1

  // Add the post to the roadmap (single insert, no transaction needed)
  await db.insert(postRoadmaps).values({
    postId: input.postId,
    roadmapId: input.roadmapId,
    position,
  })

  createActivity({
    postId: input.postId,
    principalId: actorPrincipalId ?? null,
    type: 'roadmap.added',
    metadata: { roadmapName: roadmap.name },
  })
}

/**
 * Remove a post from a roadmap
 */
export async function removePostFromRoadmap(
  postId: PostId,
  roadmapId: RoadmapId,
  actorPrincipalId?: PrincipalId
): Promise<void> {
  console.log(`[domain:roadmaps] removePostFromRoadmap: postId=${postId}, roadmapId=${roadmapId}`)
  // Remove the post from the roadmap (single delete, check result)
  const result = await db
    .delete(postRoadmaps)
    .where(and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('POST_NOT_IN_ROADMAP', `Post ${postId} is not in roadmap ${roadmapId}`)
  }

  // Look up roadmap name for the activity record
  const roadmap = await db.query.roadmaps.findFirst({
    where: eq(roadmaps.id, roadmapId),
    columns: { name: true },
  })

  createActivity({
    postId,
    principalId: actorPrincipalId ?? null,
    type: 'roadmap.removed',
    metadata: { roadmapName: roadmap?.name ?? '' },
  })
}

/**
 * Reorder posts within a roadmap
 * Uses a single batch UPDATE with CASE WHEN for efficiency
 */
export async function reorderPostsInColumn(input: ReorderPostsInput): Promise<void> {
  console.log(
    `[domain:roadmaps] reorderPostsInColumn: roadmapId=${input.roadmapId}, count=${input.postIds.length}`
  )
  // Verify roadmap exists
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, input.roadmapId) })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${input.roadmapId} not found`)
  }

  if (input.postIds.length === 0) return

  const roadmapUuid = toUuid(input.roadmapId)

  // Build CASE WHEN clause for batch update
  const cases = input.postIds
    .map((id, i) => sql`WHEN post_id = ${toUuid(id)} THEN ${i}`)
    .reduce((acc, curr) => sql`${acc} ${curr}`, sql``)
  const postIds = input.postIds.map((id) => toUuid(id))

  // Single UPDATE with CASE expression
  await db.execute(sql`
    UPDATE post_roadmaps
    SET position = CASE ${cases} END
    WHERE roadmap_id = ${roadmapUuid}
      AND post_id = ANY(${postIds}::uuid[])
  `)
}
