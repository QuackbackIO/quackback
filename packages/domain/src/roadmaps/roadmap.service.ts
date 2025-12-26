/**
 * RoadmapService - Business logic for roadmap operations
 *
 * This service handles all roadmap-related business logic including:
 * - Roadmap CRUD operations
 * - Post assignment to roadmaps
 * - Post ordering within roadmap columns
 * - Validation and authorization
 */

import {
  withUnitOfWork,
  RoadmapRepository,
  PostRepository,
  type Roadmap,
  type UnitOfWork,
} from '@quackback/db'
import type { RoadmapId, PostId } from '@quackback/ids'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { RoadmapError } from './roadmap.errors'
import type {
  CreateRoadmapInput,
  UpdateRoadmapInput,
  AddPostToRoadmapInput,
  ReorderPostsInput,
  RoadmapPostsListResult,
  RoadmapPostsQueryOptions,
} from './roadmap.types'

/**
 * Service class for roadmap domain operations
 */
export class RoadmapService {
  // ==========================================================================
  // ROADMAP CRUD
  // ==========================================================================

  /**
   * Create a new roadmap
   */
  async createRoadmap(
    input: CreateRoadmapInput,
    ctx: ServiceContext
  ): Promise<Result<Roadmap, RoadmapError>> {
    // Authorization check - only team members can create roadmaps
    if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return err(RoadmapError.unauthorized('create roadmaps'))
    }

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
        RoadmapError.validationError(
          'Slug must contain only lowercase letters, numbers, and hyphens'
        )
      )
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)

      // Check for duplicate slug
      const existing = await roadmapRepo.findBySlug(input.slug)
      if (existing) {
        return err(RoadmapError.duplicateSlug(input.slug))
      }

      // Get next position
      const position = await roadmapRepo.getNextPosition()

      // Create the roadmap
      const roadmap = await roadmapRepo.create({
        name: input.name.trim(),
        slug: input.slug.trim(),
        description: input.description?.trim() || null,
        isPublic: input.isPublic ?? true,
        position,
      })

      return ok(roadmap)
    })
  }

  /**
   * Update an existing roadmap
   */
  async updateRoadmap(
    id: RoadmapId,
    input: UpdateRoadmapInput,
    ctx: ServiceContext
  ): Promise<Result<Roadmap, RoadmapError>> {
    // Authorization check
    if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return err(RoadmapError.unauthorized('update roadmaps'))
    }

    // Validate input
    if (input.name !== undefined && !input.name.trim()) {
      return err(RoadmapError.validationError('Name cannot be empty'))
    }
    if (input.name && input.name.length > 100) {
      return err(RoadmapError.validationError('Name must be 100 characters or less'))
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)

      // Check roadmap exists
      const existing = await roadmapRepo.findById(id)
      if (!existing) {
        return err(RoadmapError.notFound(id))
      }

      // Update the roadmap
      const updateData: Partial<Omit<Roadmap, 'id' | 'createdAt'>> = {}
      if (input.name !== undefined) updateData.name = input.name.trim()
      if (input.description !== undefined)
        updateData.description = input.description?.trim() || null
      if (input.isPublic !== undefined) updateData.isPublic = input.isPublic

      const updated = await roadmapRepo.update(id, updateData)
      if (!updated) {
        return err(RoadmapError.notFound(id))
      }

      return ok(updated)
    })
  }

  /**
   * Delete a roadmap
   */
  async deleteRoadmap(id: RoadmapId, ctx: ServiceContext): Promise<Result<void, RoadmapError>> {
    // Authorization check - only owner/admin can delete
    if (!ctx.memberRole || !['owner', 'admin'].includes(ctx.memberRole)) {
      return err(RoadmapError.unauthorized('delete roadmaps'))
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)

      // Check roadmap exists
      const existing = await roadmapRepo.findById(id)
      if (!existing) {
        return err(RoadmapError.notFound(id))
      }

      // Delete the roadmap (cascade will handle post_roadmaps)
      await roadmapRepo.delete(id)

      return ok(undefined)
    })
  }

  /**
   * Get a roadmap by ID
   */
  async getRoadmap(id: RoadmapId, _ctx: ServiceContext): Promise<Result<Roadmap, RoadmapError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)
      const roadmap = await roadmapRepo.findById(id)

      if (!roadmap) {
        return err(RoadmapError.notFound(id))
      }

      return ok(roadmap)
    })
  }

  /**
   * Get a roadmap by slug
   */
  async getRoadmapBySlug(
    slug: string,
    _ctx: ServiceContext
  ): Promise<Result<Roadmap, RoadmapError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)
      const roadmap = await roadmapRepo.findBySlug(slug)

      if (!roadmap) {
        return err(RoadmapError.notFound())
      }

      return ok(roadmap)
    })
  }

  /**
   * List all roadmaps (admin view)
   */
  async listRoadmaps(_ctx: ServiceContext): Promise<Result<Roadmap[], RoadmapError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)
      const roadmaps = await roadmapRepo.findAll()
      return ok(roadmaps)
    })
  }

  /**
   * List public roadmaps (for portal view)
   */
  async listPublicRoadmaps(): Promise<Result<Roadmap[], RoadmapError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)
      const roadmaps = await roadmapRepo.findPublic()
      return ok(roadmaps)
    })
  }

  /**
   * Reorder roadmaps in the sidebar
   */
  async reorderRoadmaps(
    roadmapIds: RoadmapId[],
    ctx: ServiceContext
  ): Promise<Result<void, RoadmapError>> {
    // Authorization check
    if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return err(RoadmapError.unauthorized('reorder roadmaps'))
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)
      await roadmapRepo.reorder(roadmapIds)
      return ok(undefined)
    })
  }

  // ==========================================================================
  // POST MANAGEMENT
  // ==========================================================================

  /**
   * Add a post to a roadmap
   */
  async addPostToRoadmap(
    input: AddPostToRoadmapInput,
    ctx: ServiceContext
  ): Promise<Result<void, RoadmapError>> {
    // Authorization check
    if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return err(RoadmapError.unauthorized('add posts to roadmaps'))
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)
      const postRepo = new PostRepository(uow.db)

      // Verify roadmap exists
      const roadmap = await roadmapRepo.findById(input.roadmapId)
      if (!roadmap) {
        return err(RoadmapError.notFound(input.roadmapId))
      }

      // Verify post exists
      const post = await postRepo.findById(input.postId)
      if (!post) {
        return err(RoadmapError.postNotFound(input.postId))
      }

      // Check if post is already in roadmap
      const isInRoadmap = await roadmapRepo.isPostInRoadmap(input.postId, input.roadmapId)
      if (isInRoadmap) {
        return err(RoadmapError.postAlreadyInRoadmap(input.postId, input.roadmapId))
      }

      // Get next position in the roadmap
      const position = await roadmapRepo.getNextPostPosition(input.roadmapId)

      // Add the post to the roadmap
      await roadmapRepo.addPost({
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
  async removePostFromRoadmap(
    postId: PostId,
    roadmapId: RoadmapId,
    ctx: ServiceContext
  ): Promise<Result<void, RoadmapError>> {
    // Authorization check
    if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return err(RoadmapError.unauthorized('remove posts from roadmaps'))
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)

      // Check if post is in roadmap
      const isInRoadmap = await roadmapRepo.isPostInRoadmap(postId, roadmapId)
      if (!isInRoadmap) {
        return err(RoadmapError.postNotInRoadmap(postId, roadmapId))
      }

      // Remove the post from the roadmap
      await roadmapRepo.removePost(postId, roadmapId)

      return ok(undefined)
    })
  }

  /**
   * Reorder posts within a roadmap
   */
  async reorderPostsInColumn(
    input: ReorderPostsInput,
    ctx: ServiceContext
  ): Promise<Result<void, RoadmapError>> {
    // Authorization check
    if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return err(RoadmapError.unauthorized('reorder posts in roadmaps'))
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)

      // Verify roadmap exists
      const roadmap = await roadmapRepo.findById(input.roadmapId)
      if (!roadmap) {
        return err(RoadmapError.notFound(input.roadmapId))
      }

      // Reorder the posts
      await roadmapRepo.reorderPostsInColumn(input.roadmapId, input.postIds)

      return ok(undefined)
    })
  }

  // ==========================================================================
  // QUERYING POSTS
  // ==========================================================================

  /**
   * Get posts for a roadmap, optionally filtered by status
   */
  async getRoadmapPosts(
    roadmapId: RoadmapId,
    options: RoadmapPostsQueryOptions,
    _ctx: ServiceContext
  ): Promise<Result<RoadmapPostsListResult, RoadmapError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)

      // Verify roadmap exists
      const roadmap = await roadmapRepo.findById(roadmapId)
      if (!roadmap) {
        return err(RoadmapError.notFound(roadmapId))
      }

      const { statusId, limit = 20, offset = 0 } = options

      // Get posts
      const results = await roadmapRepo.getRoadmapPosts(roadmapId, {
        statusId,
        limit: limit + 1, // Fetch one extra to check hasMore
        offset,
      })

      // Check if there are more
      const hasMore = results.length > limit
      const items = hasMore ? results.slice(0, limit) : results

      // Get total count
      const total = await roadmapRepo.countRoadmapPosts(roadmapId, statusId)

      return ok({
        items: items.map((r) => ({
          id: r.post.id,
          title: r.post.title,
          voteCount: r.post.voteCount,
          statusId: r.post.statusId,
          board: r.post.board,
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
  async getPublicRoadmapPosts(
    roadmapId: RoadmapId,
    options: RoadmapPostsQueryOptions
  ): Promise<Result<RoadmapPostsListResult, RoadmapError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)

      // Verify roadmap exists and is public
      const roadmap = await roadmapRepo.findById(roadmapId)
      if (!roadmap) {
        return err(RoadmapError.notFound(roadmapId))
      }
      if (!roadmap.isPublic) {
        return err(RoadmapError.notFound(roadmapId))
      }

      const { statusId, limit = 20, offset = 0 } = options

      // Get posts
      const results = await roadmapRepo.getRoadmapPosts(roadmapId, {
        statusId,
        limit: limit + 1,
        offset,
      })

      const hasMore = results.length > limit
      const items = hasMore ? results.slice(0, limit) : results

      const total = await roadmapRepo.countRoadmapPosts(roadmapId, statusId)

      return ok({
        items: items.map((r) => ({
          id: r.post.id,
          title: r.post.title,
          voteCount: r.post.voteCount,
          statusId: r.post.statusId,
          board: r.post.board,
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
  async getPostRoadmaps(
    postId: PostId,
    _ctx: ServiceContext
  ): Promise<Result<Roadmap[], RoadmapError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const roadmapRepo = new RoadmapRepository(uow.db)
      const roadmaps = await roadmapRepo.getPostRoadmaps(postId)
      return ok(roadmaps)
    })
  }
}

/**
 * Singleton instance of RoadmapService
 */
export const roadmapService = new RoadmapService()
