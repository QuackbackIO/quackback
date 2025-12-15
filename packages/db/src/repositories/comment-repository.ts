import { eq, and, isNull, sql } from 'drizzle-orm'
import type { CommentId, PostId } from '@quackback/ids'
import type { Database } from '../client'
import { comments } from '../schema/posts'
import type { Comment, NewComment } from '../types'

/**
 * CommentRepository - Data access layer for comments
 *
 * This repository provides low-level database operations for comments.
 * It does NOT include business logic, validation, or authorization.
 * Use domain services for business rules and validation.
 */
export class CommentRepository {
  constructor(private readonly db: Database) {}

  /**
   * Find a comment by ID
   */
  async findById(id: CommentId): Promise<Comment | null> {
    const comment = await this.db.query.comments.findFirst({
      where: eq(comments.id, id),
    })
    return comment ?? null
  }

  /**
   * Find all comments for a post (flat list, not threaded)
   */
  async findByPostId(postId: PostId): Promise<Comment[]> {
    return this.db.query.comments.findMany({
      where: eq(comments.postId, postId),
      orderBy: (comments, { asc }) => [asc(comments.createdAt)],
    })
  }

  /**
   * Find all comments for a post including replies (for threading)
   * Returns a flat list - tree building should be done in the domain layer
   */
  async findByPostIdWithReplies(postId: PostId): Promise<Comment[]> {
    return this.db.query.comments.findMany({
      where: eq(comments.postId, postId),
      orderBy: (comments, { asc }) => [asc(comments.createdAt)],
    })
  }

  /**
   * Create a new comment
   */
  async create(data: NewComment): Promise<Comment> {
    const [comment] = await this.db.insert(comments).values(data).returning()
    return comment
  }

  /**
   * Update a comment by ID
   */
  async update(id: CommentId, data: Partial<Comment>): Promise<Comment | null> {
    const [updated] = await this.db
      .update(comments)
      .set(data)
      .where(eq(comments.id, id))
      .returning()

    return updated ?? null
  }

  /**
   * Delete a comment by ID
   */
  async delete(id: CommentId): Promise<boolean> {
    const result = await this.db.delete(comments).where(eq(comments.id, id)).returning()
    return result.length > 0
  }

  /**
   * Find all replies to a specific comment
   */
  async findReplies(parentId: CommentId): Promise<Comment[]> {
    return this.db.query.comments.findMany({
      where: eq(comments.parentId, parentId),
      orderBy: (comments, { asc }) => [asc(comments.createdAt)],
    })
  }

  /**
   * Count total comments for a post
   */
  async countByPostId(postId: PostId): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(comments)
      .where(eq(comments.postId, postId))

    return Number(result[0]?.count ?? 0)
  }

  /**
   * Find root comments (top-level, no parent) for a post
   */
  async findRootComments(postId: PostId): Promise<Comment[]> {
    return this.db.query.comments.findMany({
      where: and(eq(comments.postId, postId), isNull(comments.parentId)),
      orderBy: (comments, { asc }) => [asc(comments.createdAt)],
    })
  }
}
