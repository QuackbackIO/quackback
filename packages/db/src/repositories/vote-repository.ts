import { eq, and } from 'drizzle-orm'
import type { PostId, VoteId } from '@quackback/ids'
import type { Database } from '../client'
import { votes } from '../schema/posts'
import type { Vote, NewVote } from '../types'

/**
 * VoteRepository - Data access layer for votes
 *
 * This repository provides low-level database operations for votes.
 * It does NOT include business logic, validation, or authorization.
 * Use domain services for business rules and validation.
 */
export class VoteRepository {
  constructor(private readonly db: Database) {}

  /**
   * Find a vote by post ID and user identifier
   */
  async findByPostAndUser(postId: PostId, userIdentifier: string): Promise<Vote | null> {
    const vote = await this.db.query.votes.findFirst({
      where: and(eq(votes.postId, postId), eq(votes.userIdentifier, userIdentifier)),
    })
    return vote ?? null
  }

  /**
   * Find all votes for a post
   */
  async findByPost(postId: PostId): Promise<Vote[]> {
    return this.db.query.votes.findMany({
      where: eq(votes.postId, postId),
    })
  }

  /**
   * Create a new vote
   */
  async create(data: NewVote): Promise<Vote> {
    const [vote] = await this.db.insert(votes).values(data).returning()
    return vote
  }

  /**
   * Delete a vote by ID
   */
  async delete(id: VoteId): Promise<boolean> {
    const result = await this.db.delete(votes).where(eq(votes.id, id)).returning()
    return result.length > 0
  }

  /**
   * Delete a vote by post ID and user identifier
   */
  async deleteByPostAndUser(postId: PostId, userIdentifier: string): Promise<boolean> {
    const result = await this.db
      .delete(votes)
      .where(and(eq(votes.postId, postId), eq(votes.userIdentifier, userIdentifier)))
      .returning()
    return result.length > 0
  }
}
