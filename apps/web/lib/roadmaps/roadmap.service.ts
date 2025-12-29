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
} from '@quackback/db'
import type { RoadmapId, PostId } from '@quackback/ids'
import { ok, err, type Result } from '@/lib/shared'
import { RoadmapError } from './roadmap.errors'
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
export async function createRoadmap(
  input: CreateRoadmapInput
): Promise<Result<Roadmap, RoadmapError>> {
  // Validate input
  if (!input.name?.trim()) {
    return err(RoadmapError.validationError('Name is required'))
  }
  if (!input.slug?.trim()) {
    return err(RoadmapError.validationError('Slug is required'))
  }
  if (input.name.length > 100) {
    return err(RoadmapError.validationError('Name must be 100 characters or less'))
  }
  if (!/^[a-z0-9-]+$/.test(input.slug)) {
    return err(
      RoadmapError.validationError('Slug must contain only lowercase letters, numbers, and hyphens')
    )
  }

  return db.transaction(async (tx) => {
    // Check for duplicate slug
    const existing = await tx.query.roadmaps.findFirst({
      where: eq(roadmaps.slug, input.slug),
    })
    if (existing) {
      return err(RoadmapError.duplicateSlug(input.slug))
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

    return ok(roadmap)
  })
}

/**
 * Update an existing roadmap
 */
export async function updateRoadmap(
  id: RoadmapId,
  input: UpdateRoadmapInput
): Promise<Result<Roadmap, RoadmapError>> {
  // Validate input
  if (input.name !== undefined && !input.name.trim()) {
    return err(RoadmapError.validationError('Name cannot be empty'))
  }
  if (input.name && input.name.length > 100) {
    return err(RoadmapError.validationError('Name must be 100 characters or less'))
  }

  return db.transaction(async (tx) => {
    // Check roadmap exists
    const existing = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, id) })
    if (!existing) {
      return err(RoadmapError.notFound(id))
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
      return err(RoadmapError.notFound(id))
    }

    return ok(updated)
  })
}

/**
 * Delete a roadmap
 */
export async function deleteRoadmap(id: RoadmapId): Promise<Result<void, RoadmapError>> {
  return db.transaction(async (tx) => {
    // Check roadmap exists
    const existing = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, id) })
    if (!existing) {
      return err(RoadmapError.notFound(id))
    }

    // Delete the roadmap (cascade will handle post_roadmaps)
    await tx.delete(roadmaps).where(eq(roadmaps.id, id)).returning()

    return ok(undefined)
  })
}

/**
 * Get a roadmap by ID
 */
export async function getRoadmap(id: RoadmapId): Promise<Result<Roadmap, RoadmapError>> {
  return db.transaction(async (tx) => {
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, id) })

    if (!roadmap) {
      return err(RoadmapError.notFound(id))
    }

    return ok(roadmap)
  })
}

/**
 * Get a roadmap by slug
 */
export async function getRoadmapBySlug(slug: string): Promise<Result<Roadmap, RoadmapError>> {
  return db.transaction(async (tx) => {
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.slug, slug) })

    if (!roadmap) {
      return err(RoadmapError.notFound())
    }

    return ok(roadmap)
  })
}

/**
 * List all roadmaps (admin view)
 */
export async function listRoadmaps(): Promise<Result<Roadmap[], RoadmapError>> {
  return db.transaction(async (tx) => {
    const allRoadmaps = await tx.query.roadmaps.findMany({ orderBy: [asc(roadmaps.position)] })
    return ok(allRoadmaps)
  })
}

/**
 * List public roadmaps (for portal view)
 */
export async function listPublicRoadmaps(): Promise<Result<Roadmap[], RoadmapError>> {
  return db.transaction(async (tx) => {
    const publicRoadmaps = await tx.query.roadmaps.findMany({
      where: eq(roadmaps.isPublic, true),
      orderBy: [asc(roadmaps.position)],
    })
    return ok(publicRoadmaps)
  })
}

/**
 * Reorder roadmaps in the sidebar
 */
export async function reorderRoadmaps(
  roadmapIds: RoadmapId[]
): Promise<Result<void, RoadmapError>> {
  return db.transaction(async (tx) => {
    await Promise.all(
      roadmapIds.map((id, index) =>
        tx.update(roadmaps).set({ position: index }).where(eq(roadmaps.id, id))
      )
    )
    return ok(undefined)
  })
}

// ==========================================================================
// POST MANAGEMENT
// ==========================================================================

/**
 * Add a post to a roadmap
 */
export async function addPostToRoadmap(
  input: AddPostToRoadmapInput
): Promise<Result<void, RoadmapError>> {
  return db.transaction(async (tx) => {
    // Verify roadmap exists
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, input.roadmapId) })
    if (!roadmap) {
      return err(RoadmapError.notFound(input.roadmapId))
    }

    // Verify post exists
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, input.postId) })
    if (!post) {
      return err(RoadmapError.postNotFound(input.postId))
    }

    // Check if post is already in roadmap
    const existingEntry = await tx.query.postRoadmaps.findFirst({
      where: and(
        eq(postRoadmaps.postId, input.postId),
        eq(postRoadmaps.roadmapId, input.roadmapId)
      ),
    })
    if (existingEntry) {
      return err(RoadmapError.postAlreadyInRoadmap(input.postId, input.roadmapId))
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

    return ok(undefined)
  })
}

/**
 * Remove a post from a roadmap
 */
export async function removePostFromRoadmap(
  postId: PostId,
  roadmapId: RoadmapId
): Promise<Result<void, RoadmapError>> {
  return db.transaction(async (tx) => {
    // Check if post is in roadmap
    const existingEntry = await tx.query.postRoadmaps.findFirst({
      where: and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)),
    })
    if (!existingEntry) {
      return err(RoadmapError.postNotInRoadmap(postId, roadmapId))
    }

    // Remove the post from the roadmap
    await tx
      .delete(postRoadmaps)
      .where(and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)))

    return ok(undefined)
  })
}

/**
 * Reorder posts within a roadmap
 */
export async function reorderPostsInColumn(
  input: ReorderPostsInput
): Promise<Result<void, RoadmapError>> {
  return db.transaction(async (tx) => {
    // Verify roadmap exists
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, input.roadmapId) })
    if (!roadmap) {
      return err(RoadmapError.notFound(input.roadmapId))
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

    return ok(undefined)
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
): Promise<Result<RoadmapPostsListResult, RoadmapError>> {
  return db.transaction(async (tx) => {
    // Verify roadmap exists
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, roadmapId) })
    if (!roadmap) {
      return err(RoadmapError.notFound(roadmapId))
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

    return ok({
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
    })
  })
}

/**
 * Get public roadmap posts (no auth required)
 */
export async function getPublicRoadmapPosts(
  roadmapId: RoadmapId,
  options: RoadmapPostsQueryOptions
): Promise<Result<RoadmapPostsListResult, RoadmapError>> {
  return db.transaction(async (tx) => {
    // Verify roadmap exists and is public
    const roadmap = await tx.query.roadmaps.findFirst({ where: eq(roadmaps.id, roadmapId) })
    if (!roadmap) {
      return err(RoadmapError.notFound(roadmapId))
    }
    if (!roadmap.isPublic) {
      return err(RoadmapError.notFound(roadmapId))
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

    return ok({
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
    })
  })
}

/**
 * Get all roadmaps a post belongs to
 */
export async function getPostRoadmaps(postId: PostId): Promise<Result<Roadmap[], RoadmapError>> {
  return db.transaction(async (tx) => {
    const entries = await tx
      .select({ roadmap: roadmaps })
      .from(postRoadmaps)
      .innerJoin(roadmaps, eq(postRoadmaps.roadmapId, roadmaps.id))
      .where(eq(postRoadmaps.postId, postId))
      .orderBy(asc(roadmaps.position))

    const roadmapsList = entries.map((e) => e.roadmap)
    return ok(roadmapsList)
  })
}
