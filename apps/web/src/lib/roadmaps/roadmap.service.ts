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
  asc,
  sql,
  roadmaps,
  posts,
  postRoadmaps,
  boards,
  type Roadmap,
} from '@/lib/db'
import type { RoadmapId, PostId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import type {
  CreateRoadmapInput,
  UpdateRoadmapInput,
  AddPostToRoadmapInput,
  ReorderPostsInput,
  RoadmapPostsListResult,
  RoadmapPostsQueryOptions,
} from './roadmap.types'

// ==========================================================================
// ROADMAP CRUD
// ==========================================================================

/**
 * Create a new roadmap
 */
export async function createRoadmap(input: CreateRoadmapInput): Promise<Roadmap> {
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

  return db.transaction(async (tx) => {
    // Check for duplicate slug
    const existing = await tx.query.roadmaps.findFirst({
      where: eq(roadmaps.slug, input.slug),
    })
    if (existing) {
      throw new ConflictError(
        'DUPLICATE_SLUG',
        `A roadmap with slug "${input.slug}" already exists`
      )
    }

    // Get next position
    const positionResult = await tx
      .select({ maxPosition: sql<number>`COALESCE(MAX(${roadmaps.position}), -1)` })
      .from(roadmaps)
    const position = (positionResult[0]?.maxPosition ?? -1) + 1

    // Create the roadmap
    const [roadmap] = await tx
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
  })
}

/**
 * Update an existing roadmap
 */
export async function updateRoadmap(id: RoadmapId, input: UpdateRoadmapInput): Promise<Roadmap> {
  // Validate input
  if (input.name !== undefined && !input.name.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Name cannot be empty')
  }
  if (input.name && input.name.length > 100) {
    throw new ValidationError('VALIDATION_ERROR', 'Name must be 100 characters or less')
  }

  return db.transaction(async (tx) => {
    // Check roadmap exists
    const existing = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, id) })
    if (!existing) {
      throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
    }

    // Update the roadmap
    const updateData: Partial<Omit<Roadmap, 'id' | 'createdAt'>> = {}
    if (input.name !== undefined) updateData.name = input.name.trim()
    if (input.description !== undefined) updateData.description = input.description?.trim() || null
    if (input.isPublic !== undefined) updateData.isPublic = input.isPublic

    const [updated] = await tx
      .update(roadmaps)
      .set(updateData)
      .where(eq(roadmaps.id, id))
      .returning()
    if (!updated) {
      throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
    }

    return updated
  })
}

/**
 * Delete a roadmap
 */
export async function deleteRoadmap(id: RoadmapId): Promise<void> {
  return db.transaction(async (tx) => {
    // Check roadmap exists
    const existing = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, id) })
    if (!existing) {
      throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
    }

    // Delete the roadmap (cascade will handle post_roadmaps)
    await tx.delete(roadmaps).where(eq(roadmaps.id, id)).returning()
  })
}

/**
 * Get a roadmap by ID
 */
export async function getRoadmap(id: RoadmapId): Promise<Roadmap> {
  return db.transaction(async (tx) => {
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, id) })

    if (!roadmap) {
      throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
    }

    return roadmap
  })
}

/**
 * Get a roadmap by slug
 */
export async function getRoadmapBySlug(slug: string): Promise<Roadmap> {
  return db.transaction(async (tx) => {
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.slug, slug) })

    if (!roadmap) {
      throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with slug "${slug}" not found`)
    }

    return roadmap
  })
}

/**
 * List all roadmaps (admin view)
 */
export async function listRoadmaps(): Promise<Roadmap[]> {
  return db.transaction(async (tx) => {
    const allRoadmaps = await tx.query.roadmaps.findMany({ orderBy: [asc(roadmaps.position)] })
    return allRoadmaps
  })
}

/**
 * List public roadmaps (for portal view)
 */
export async function listPublicRoadmaps(): Promise<Roadmap[]> {
  return db.transaction(async (tx) => {
    const publicRoadmaps = await tx.query.roadmaps.findMany({
      where: eq(roadmaps.isPublic, true),
      orderBy: [asc(roadmaps.position)],
    })
    return publicRoadmaps
  })
}

/**
 * Reorder roadmaps in the sidebar
 */
export async function reorderRoadmaps(roadmapIds: RoadmapId[]): Promise<void> {
  return db.transaction(async (tx) => {
    await Promise.all(
      roadmapIds.map((id, index) =>
        tx.update(roadmaps).set({ position: index }).where(eq(roadmaps.id, id))
      )
    )
  })
}

// ==========================================================================
// POST MANAGEMENT
// ==========================================================================

/**
 * Add a post to a roadmap
 */
export async function addPostToRoadmap(input: AddPostToRoadmapInput): Promise<void> {
  return db.transaction(async (tx) => {
    // Verify roadmap exists
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, input.roadmapId) })
    if (!roadmap) {
      throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${input.roadmapId} not found`)
    }

    // Verify post exists
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, input.postId) })
    if (!post) {
      throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${input.postId} not found`)
    }

    // Check if post is already in roadmap
    const existingEntry = await tx.query.postRoadmaps.findFirst({
      where: and(
        eq(postRoadmaps.postId, input.postId),
        eq(postRoadmaps.roadmapId, input.roadmapId)
      ),
    })
    if (existingEntry) {
      throw new ConflictError(
        'POST_ALREADY_IN_ROADMAP',
        `Post ${input.postId} is already in roadmap ${input.roadmapId}`
      )
    }

    // Get next position in the roadmap
    const positionResult = await tx
      .select({ maxPosition: sql<number>`COALESCE(MAX(${postRoadmaps.position}), -1)` })
      .from(postRoadmaps)
      .where(eq(postRoadmaps.roadmapId, input.roadmapId))
    const position = (positionResult[0]?.maxPosition ?? -1) + 1

    // Add the post to the roadmap
    await tx.insert(postRoadmaps).values({
      postId: input.postId,
      roadmapId: input.roadmapId,
      position,
    })
  })
}

/**
 * Remove a post from a roadmap
 */
export async function removePostFromRoadmap(postId: PostId, roadmapId: RoadmapId): Promise<void> {
  return db.transaction(async (tx) => {
    // Check if post is in roadmap
    const existingEntry = await tx.query.postRoadmaps.findFirst({
      where: and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)),
    })
    if (!existingEntry) {
      throw new NotFoundError(
        'POST_NOT_IN_ROADMAP',
        `Post ${postId} is not in roadmap ${roadmapId}`
      )
    }

    // Remove the post from the roadmap
    await tx
      .delete(postRoadmaps)
      .where(and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)))
  })
}

/**
 * Reorder posts within a roadmap
 */
export async function reorderPostsInColumn(input: ReorderPostsInput): Promise<void> {
  return db.transaction(async (tx) => {
    // Verify roadmap exists
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, input.roadmapId) })
    if (!roadmap) {
      throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${input.roadmapId} not found`)
    }

    // Reorder the posts
    await Promise.all(
      input.postIds.map((postId, index) =>
        tx
          .update(postRoadmaps)
          .set({ position: index })
          .where(and(eq(postRoadmaps.roadmapId, input.roadmapId), eq(postRoadmaps.postId, postId)))
      )
    )
  })
}

// ==========================================================================
// QUERYING POSTS
// ==========================================================================

/**
 * Get posts for a roadmap, optionally filtered by status
 */
export async function getRoadmapPosts(
  roadmapId: RoadmapId,
  options: RoadmapPostsQueryOptions
): Promise<RoadmapPostsListResult> {
  return db.transaction(async (tx) => {
    // Verify roadmap exists
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, roadmapId) })
    if (!roadmap) {
      throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
    }

    const { statusId, limit = 20, offset = 0 } = options

    // Get posts with JOIN
    const conditions = [eq(postRoadmaps.roadmapId, roadmapId)]
    if (statusId) {
      conditions.push(eq(posts.statusId, statusId))
    }

    const results = await tx
      .select({
        post: {
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          statusId: posts.statusId,
        },
        board: {
          id: boards.id,
          name: boards.name,
          slug: boards.slug,
        },
        roadmapEntry: postRoadmaps,
      })
      .from(postRoadmaps)
      .innerJoin(posts, eq(postRoadmaps.postId, posts.id))
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...conditions))
      .orderBy(asc(postRoadmaps.position))
      .limit(limit + 1)
      .offset(offset)

    // Check if there are more
    const hasMore = results.length > limit
    const items = hasMore ? results.slice(0, limit) : results

    // Get total count
    const countResult = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(postRoadmaps)
      .innerJoin(posts, eq(postRoadmaps.postId, posts.id))
      .where(and(...conditions))
    const total = Number(countResult[0]?.count ?? 0)

    return {
      items: items.map((r) => ({
        id: r.post.id,
        title: r.post.title,
        voteCount: r.post.voteCount,
        statusId: r.post.statusId,
        board: r.board,
        roadmapEntry: r.roadmapEntry,
      })),
      total,
      hasMore,
    }
  })
}

/**
 * Get public roadmap posts (no auth required)
 */
export async function getPublicRoadmapPosts(
  roadmapId: RoadmapId,
  options: RoadmapPostsQueryOptions
): Promise<RoadmapPostsListResult> {
  return db.transaction(async (tx) => {
    // Verify roadmap exists and is public
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, roadmapId) })
    if (!roadmap) {
      throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
    }
    if (!roadmap.isPublic) {
      throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
    }

    const { statusId, limit = 20, offset = 0 } = options

    // Get posts with JOIN
    const conditions = [eq(postRoadmaps.roadmapId, roadmapId)]
    if (statusId) {
      conditions.push(eq(posts.statusId, statusId))
    }

    const results = await tx
      .select({
        post: {
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          statusId: posts.statusId,
        },
        board: {
          id: boards.id,
          name: boards.name,
          slug: boards.slug,
        },
        roadmapEntry: postRoadmaps,
      })
      .from(postRoadmaps)
      .innerJoin(posts, eq(postRoadmaps.postId, posts.id))
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...conditions))
      .orderBy(asc(postRoadmaps.position))
      .limit(limit + 1)
      .offset(offset)

    const hasMore = results.length > limit
    const items = hasMore ? results.slice(0, limit) : results

    // Get total count
    const countResult = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(postRoadmaps)
      .innerJoin(posts, eq(postRoadmaps.postId, posts.id))
      .where(and(...conditions))
    const total = Number(countResult[0]?.count ?? 0)

    return {
      items: items.map((r) => ({
        id: r.post.id,
        title: r.post.title,
        voteCount: r.post.voteCount,
        statusId: r.post.statusId,
        board: r.board,
        roadmapEntry: r.roadmapEntry,
      })),
      total,
      hasMore,
    }
  })
}

/**
 * Get all roadmaps a post belongs to
 */
export async function getPostRoadmaps(postId: PostId): Promise<Roadmap[]> {
  return db.transaction(async (tx) => {
    const entries = await tx
      .select({ roadmap: roadmaps })
      .from(postRoadmaps)
      .innerJoin(roadmaps, eq(postRoadmaps.roadmapId, roadmaps.id))
      .where(eq(postRoadmaps.postId, postId))
      .orderBy(asc(roadmaps.position))

    const roadmapsList = entries.map((e) => e.roadmap)
    return roadmapsList
  })
}
