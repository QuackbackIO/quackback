import { eq, sql } from 'drizzle-orm'
import type { PostId, BoardId, TagId } from '@quackback/ids'
import type { Database } from '../client'
import { posts, postTags } from '../schema/posts'
import type { Post, NewPost } from '../types'

/**
 * PostRepository - Data access layer for posts
 *
 * This repository provides low-level database operations for posts.
 * It does NOT include business logic, validation, or authorization.
 * Use domain services for business rules and validation.
 */
export class PostRepository {
  constructor(private readonly db: Database) {}

  /**
   * Find a post by ID
   */
  async findById(id: PostId): Promise<Post | null> {
    const post = await this.db.query.posts.findFirst({
      where: eq(posts.id, id),
    })
    return post ?? null
  }

  /**
   * Find a post by slug within a board
   * Note: Posts don't have slugs in the current schema.
   * This method is reserved for future use when slug support is added.
   */
  async findBySlug(_boardId: BoardId, _slug: string): Promise<Post | null> {
    // This is a placeholder for when posts get slug support
    // For now, we'll return null as posts don't have slugs
    return null
  }

  /**
   * Find all posts for a board with pagination
   */
  async findByBoardId(
    boardId: BoardId,
    options?: { limit?: number; offset?: number }
  ): Promise<Post[]> {
    const { limit = 20, offset = 0 } = options ?? {}

    return this.db.query.posts.findMany({
      where: eq(posts.boardId, boardId),
      limit,
      offset,
    })
  }

  /**
   * Create a new post
   */
  async create(data: NewPost): Promise<Post> {
    const [post] = await this.db.insert(posts).values(data).returning()
    return post
  }

  /**
   * Update a post by ID
   */
  async update(id: PostId, data: Partial<Post>): Promise<Post | null> {
    const [updated] = await this.db
      .update(posts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(posts.id, id))
      .returning()

    return updated ?? null
  }

  /**
   * Delete a post by ID
   */
  async delete(id: PostId): Promise<boolean> {
    const result = await this.db.delete(posts).where(eq(posts.id, id)).returning()
    return result.length > 0
  }

  /**
   * Increment vote count for a post
   */
  async incrementVoteCount(id: PostId): Promise<void> {
    await this.db
      .update(posts)
      .set({ voteCount: sql`${posts.voteCount} + 1` })
      .where(eq(posts.id, id))
  }

  /**
   * Decrement vote count for a post
   */
  async decrementVoteCount(id: PostId): Promise<void> {
    await this.db
      .update(posts)
      .set({ voteCount: sql`${posts.voteCount} - 1` })
      .where(eq(posts.id, id))
  }

  /**
   * Set tags for a post (replaces all existing tags)
   */
  async setTags(postId: PostId, tagIds: TagId[]): Promise<void> {
    // Remove all existing tags
    await this.db.delete(postTags).where(eq(postTags.postId, postId))

    // Add new tags if any
    if (tagIds.length > 0) {
      await this.db.insert(postTags).values(tagIds.map((tagId) => ({ postId, tagId })))
    }
  }
}
