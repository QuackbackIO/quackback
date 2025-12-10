import { eq, and, asc, sql } from 'drizzle-orm'
import type { Database } from '../client'
import { roadmaps, boards } from '../schema/boards'
import { postRoadmaps, posts } from '../schema/posts'
import type { Roadmap, NewRoadmap, PostRoadmap, NewPostRoadmap } from '../types'

/**
 * RoadmapRepository - Data access layer for roadmaps
 *
 * This repository provides low-level database operations for roadmaps.
 * It does NOT include business logic, validation, or authorization.
 * Use domain services for business rules and validation.
 */
export class RoadmapRepository {
  constructor(private readonly db: Database) {}

  // ==========================================================================
  // ROADMAP CRUD
  // ==========================================================================

  /**
   * Find a roadmap by ID
   */
  async findById(id: string): Promise<Roadmap | null> {
    const roadmap = await this.db.query.roadmaps.findFirst({
      where: eq(roadmaps.id, id),
    })
    return roadmap ?? null
  }

  /**
   * Find a roadmap by slug within an organization
   */
  async findBySlug(organizationId: string, slug: string): Promise<Roadmap | null> {
    const roadmap = await this.db.query.roadmaps.findFirst({
      where: and(eq(roadmaps.organizationId, organizationId), eq(roadmaps.slug, slug)),
    })
    return roadmap ?? null
  }

  /**
   * Find all roadmaps for an organization, ordered by position
   */
  async findAll(organizationId: string): Promise<Roadmap[]> {
    return this.db.query.roadmaps.findMany({
      where: eq(roadmaps.organizationId, organizationId),
      orderBy: [asc(roadmaps.position)],
    })
  }

  /**
   * Find all public roadmaps for an organization
   */
  async findPublic(organizationId: string): Promise<Roadmap[]> {
    return this.db.query.roadmaps.findMany({
      where: and(eq(roadmaps.organizationId, organizationId), eq(roadmaps.isPublic, true)),
      orderBy: [asc(roadmaps.position)],
    })
  }

  /**
   * Create a new roadmap
   */
  async create(data: NewRoadmap): Promise<Roadmap> {
    const [roadmap] = await this.db.insert(roadmaps).values(data).returning()
    return roadmap
  }

  /**
   * Update a roadmap by ID
   */
  async update(
    id: string,
    data: Partial<Omit<Roadmap, 'id' | 'organizationId' | 'createdAt'>>
  ): Promise<Roadmap | null> {
    const [updated] = await this.db
      .update(roadmaps)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(roadmaps.id, id))
      .returning()

    return updated ?? null
  }

  /**
   * Delete a roadmap by ID
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(roadmaps).where(eq(roadmaps.id, id)).returning()
    return result.length > 0
  }

  /**
   * Reorder roadmaps by updating their positions
   */
  async reorder(ids: string[]): Promise<void> {
    await Promise.all(
      ids.map((id, index) =>
        this.db.update(roadmaps).set({ position: index }).where(eq(roadmaps.id, id))
      )
    )
  }

  /**
   * Get the next position for a new roadmap in an organization
   */
  async getNextPosition(organizationId: string): Promise<number> {
    const result = await this.db
      .select({ maxPosition: sql<number>`COALESCE(MAX(${roadmaps.position}), -1)` })
      .from(roadmaps)
      .where(eq(roadmaps.organizationId, organizationId))

    return (result[0]?.maxPosition ?? -1) + 1
  }

  // ==========================================================================
  // POST-ROADMAP JUNCTION
  // ==========================================================================

  /**
   * Add a post to a roadmap
   */
  async addPost(data: NewPostRoadmap): Promise<PostRoadmap> {
    const [entry] = await this.db.insert(postRoadmaps).values(data).returning()
    return entry
  }

  /**
   * Remove a post from a roadmap
   */
  async removePost(postId: string, roadmapId: string): Promise<boolean> {
    const result = await this.db
      .delete(postRoadmaps)
      .where(and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)))
      .returning()
    return result.length > 0
  }

  /**
   * Check if a post is in a roadmap
   */
  async isPostInRoadmap(postId: string, roadmapId: string): Promise<boolean> {
    const entry = await this.db.query.postRoadmaps.findFirst({
      where: and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)),
    })
    return !!entry
  }

  /**
   * Update the status column for a post in a roadmap
   */
  async updatePostStatus(
    postId: string,
    roadmapId: string,
    statusId: string
  ): Promise<PostRoadmap | null> {
    const [updated] = await this.db
      .update(postRoadmaps)
      .set({ statusId })
      .where(and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)))
      .returning()

    return updated ?? null
  }

  /**
   * Reorder posts within a roadmap column (by status)
   */
  async reorderPostsInColumn(
    roadmapId: string,
    statusId: string,
    postIds: string[]
  ): Promise<void> {
    await Promise.all(
      postIds.map((postId, index) =>
        this.db
          .update(postRoadmaps)
          .set({ position: index })
          .where(
            and(
              eq(postRoadmaps.roadmapId, roadmapId),
              eq(postRoadmaps.postId, postId),
              eq(postRoadmaps.statusId, statusId)
            )
          )
      )
    )
  }

  /**
   * Get the next position for a post in a roadmap column
   */
  async getNextPostPosition(roadmapId: string, statusId: string): Promise<number> {
    const result = await this.db
      .select({ maxPosition: sql<number>`COALESCE(MAX(${postRoadmaps.position}), -1)` })
      .from(postRoadmaps)
      .where(and(eq(postRoadmaps.roadmapId, roadmapId), eq(postRoadmaps.statusId, statusId)))

    return (result[0]?.maxPosition ?? -1) + 1
  }

  /**
   * Get posts for a roadmap, optionally filtered by status
   * Returns posts with their roadmap entry data (position, statusId)
   */
  async getRoadmapPosts(
    roadmapId: string,
    options: {
      statusId?: string
      limit?: number
      offset?: number
    } = {}
  ): Promise<
    {
      post: {
        id: string
        title: string
        voteCount: number
        board: { id: string; name: string; slug: string }
      }
      roadmapEntry: PostRoadmap
    }[]
  > {
    const { statusId, limit = 10, offset = 0 } = options

    const conditions = [eq(postRoadmaps.roadmapId, roadmapId)]
    if (statusId) {
      conditions.push(eq(postRoadmaps.statusId, statusId))
    }

    const results = await this.db
      .select({
        post: {
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
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
      .limit(limit)
      .offset(offset)

    return results.map((r) => ({
      post: {
        id: r.post.id,
        title: r.post.title,
        voteCount: r.post.voteCount,
        board: r.board,
      },
      roadmapEntry: r.roadmapEntry,
    }))
  }

  /**
   * Count posts in a roadmap, optionally filtered by status
   */
  async countRoadmapPosts(roadmapId: string, statusId?: string): Promise<number> {
    const conditions = [eq(postRoadmaps.roadmapId, roadmapId)]
    if (statusId) {
      conditions.push(eq(postRoadmaps.statusId, statusId))
    }

    const result = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(postRoadmaps)
      .where(and(...conditions))

    return Number(result[0]?.count ?? 0)
  }

  /**
   * Get all roadmaps a post belongs to
   */
  async getPostRoadmaps(postId: string): Promise<Roadmap[]> {
    const entries = await this.db
      .select({ roadmap: roadmaps })
      .from(postRoadmaps)
      .innerJoin(roadmaps, eq(postRoadmaps.roadmapId, roadmaps.id))
      .where(eq(postRoadmaps.postId, postId))
      .orderBy(asc(roadmaps.position))

    return entries.map((e) => e.roadmap)
  }
}
