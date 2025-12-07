import { eq, inArray } from 'drizzle-orm'
import type { Database } from '../client'
import { tags, postTags, posts } from '../schema'
import type { Tag, NewTag } from '../types'

/**
 * TagRepository - Data access layer for tags
 *
 * This repository provides low-level database operations for tags.
 * It does NOT include business logic, validation, or authorization.
 * Use domain services for business rules and validation.
 */
export class TagRepository {
  constructor(private readonly db: Database) {}

  /**
   * Find a tag by ID
   */
  async findById(id: string): Promise<Tag | null> {
    const tag = await this.db.query.tags.findFirst({
      where: eq(tags.id, id),
    })
    return tag ?? null
  }

  /**
   * Find multiple tags by IDs
   */
  async findByIds(ids: string[]): Promise<Tag[]> {
    if (ids.length === 0) {
      return []
    }

    return this.db.query.tags.findMany({
      where: inArray(tags.id, ids),
    })
  }

  /**
   * Find all tags
   */
  async findAll(): Promise<Tag[]> {
    return this.db.query.tags.findMany({
      orderBy: (tags, { asc }) => [asc(tags.name)],
    })
  }

  /**
   * Find all tags used in a specific board
   * This queries the post_tags junction table to find tags associated with posts in the board
   */
  async findByBoardId(boardId: string): Promise<Tag[]> {
    // Get unique tag IDs used by posts in this board
    const tagResults = await this.db
      .selectDistinct({ id: tags.id })
      .from(tags)
      .innerJoin(postTags, eq(tags.id, postTags.tagId))
      .innerJoin(posts, eq(postTags.postId, posts.id))
      .where(eq(posts.boardId, boardId))

    if (tagResults.length === 0) {
      return []
    }

    // Fetch full tag details
    const tagIds = tagResults.map((t) => t.id)
    return this.findByIds(tagIds)
  }

  /**
   * Create a new tag
   */
  async create(data: NewTag): Promise<Tag> {
    const [tag] = await this.db.insert(tags).values(data).returning()
    return tag
  }

  /**
   * Update a tag by ID
   */
  async update(id: string, data: Partial<Tag>): Promise<Tag | null> {
    const [updated] = await this.db.update(tags).set(data).where(eq(tags.id, id)).returning()

    return updated ?? null
  }

  /**
   * Delete a tag by ID
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(tags).where(eq(tags.id, id)).returning()
    return result.length > 0
  }
}
