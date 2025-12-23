/**
 * PublicPostService - Read-only operations that don't require authentication
 *
 * This service handles all public-facing post operations including:
 * - Listing posts on public boards
 * - Viewing post details
 * - Roadmap views
 * - Vote status checks
 *
 * All methods in this file are safe for unauthenticated access.
 */

import {
  db,
  eq,
  and,
  inArray,
  desc,
  asc,
  sql,
  posts,
  boards,
  postTags,
  tags,
  comments,
  votes,
  postStatuses,
} from '@quackback/db'
import type { PostId, StatusId, TagId, CommentId } from '@quackback/ids'
import { ok, type Result } from '../shared/result'
import { PostError } from './post.errors'
import { buildCommentTree } from '../shared/comment-tree'
import type {
  PublicPostListResult,
  RoadmapPost,
  RoadmapPostListResult,
  PublicPostDetail,
  PublicComment,
} from './post.types'

/**
 * Service class for public post operations (no authentication required)
 */
export class PublicPostService {
  /**
   * List posts for public portal (no authentication required)
   *
   * @param params - Query parameters including boardSlug, search, statusIds/statusSlugs, sort, pagination
   * @returns Result containing public post list or an error
   */
  async listPosts(params: {
    boardSlug?: string
    search?: string
    /** Filter by status IDs (legacy, prefer statusSlugs) */
    statusIds?: StatusId[]
    /** Filter by status slugs - uses indexed lookup */
    statusSlugs?: string[]
    tagIds?: TagId[]
    sort?: 'top' | 'new' | 'trending'
    page?: number
    limit?: number
  }): Promise<Result<PublicPostListResult, PostError>> {
    const {
      boardSlug,
      search,
      statusIds,
      statusSlugs,
      tagIds,
      sort = 'top',
      page = 1,
      limit = 20,
    } = params
    const offset = (page - 1) * limit

    // Build where conditions - only include posts from public boards
    const conditions = [eq(boards.isPublic, true)]

    if (boardSlug) {
      conditions.push(eq(boards.slug, boardSlug))
    }

    // Status filter - resolve slugs to IDs using indexed lookup, or use IDs directly
    let resolvedStatusIds = statusIds
    if (statusSlugs && statusSlugs.length > 0) {
      const statusesBySlug = await db.query.postStatuses.findMany({
        where: inArray(postStatuses.slug, statusSlugs),
        columns: { id: true },
      })
      resolvedStatusIds = (statusesBySlug ?? []).map((s) => s.id)
    }

    if (resolvedStatusIds && resolvedStatusIds.length > 0) {
      conditions.push(inArray(posts.statusId, resolvedStatusIds))
    }

    // Tag filter - posts must have at least one of the selected tags
    if (tagIds && tagIds.length > 0) {
      const postsWithSelectedTags = await db
        .selectDistinct({ postId: postTags.postId })
        .from(postTags)
        .where(inArray(postTags.tagId, tagIds))

      const postIdsWithTags = postsWithSelectedTags.map((p) => p.postId)

      if (postIdsWithTags.length === 0) {
        return ok({ items: [], total: 0, hasMore: false })
      }
      conditions.push(inArray(posts.id, postIdsWithTags))
    }

    // Full-text search using tsvector (much faster than ILIKE)
    if (search) {
      conditions.push(sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${search})`)
    }

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...conditions))

    const total = countResult?.count || 0

    // Determine sort order
    const orderBy =
      sort === 'new'
        ? desc(posts.createdAt)
        : sort === 'trending'
          ? sql`(${posts.voteCount} / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - ${posts.createdAt})) / 86400)) DESC`
          : desc(posts.voteCount) // 'top' is default

    // Get posts with board info (without comment count - fetched separately)
    const postsResult = await db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
        statusId: posts.statusId,
        voteCount: posts.voteCount,
        authorName: posts.authorName,
        memberId: posts.memberId,
        createdAt: posts.createdAt,
        boardId: boards.id,
        boardName: boards.name,
        boardSlug: boards.slug,
      })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset)

    const postIds = postsResult.map((p) => p.id)

    // Batch fetch comment counts and tags in parallel
    const [commentCountsResult, tagsResult] = await Promise.all([
      postIds.length > 0
        ? db
            .select({
              postId: comments.postId,
              count: sql<number>`count(*)::int`,
            })
            .from(comments)
            .where(inArray(comments.postId, postIds))
            .groupBy(comments.postId)
        : Promise.resolve([]),
      postIds.length > 0
        ? db
            .select({
              postId: postTags.postId,
              id: tags.id,
              name: tags.name,
              color: tags.color,
            })
            .from(postTags)
            .innerJoin(tags, eq(tags.id, postTags.tagId))
            .where(inArray(postTags.postId, postIds))
        : Promise.resolve([]),
    ])

    // Build lookup maps
    const commentCountByPost = new Map<PostId, number>()
    for (const row of commentCountsResult) {
      commentCountByPost.set(row.postId, row.count)
    }

    const tagsByPost = new Map<PostId, Array<{ id: TagId; name: string; color: string }>>()
    for (const row of tagsResult) {
      const existing = tagsByPost.get(row.postId) || []
      existing.push({ id: row.id, name: row.name, color: row.color })
      tagsByPost.set(row.postId, existing)
    }

    const items = postsResult.map((post) => ({
      id: post.id,
      title: post.title,
      content: post.content,
      statusId: post.statusId,
      voteCount: post.voteCount,
      authorName: post.authorName,
      memberId: post.memberId,
      createdAt: post.createdAt,
      commentCount: commentCountByPost.get(post.id) || 0,
      tags: tagsByPost.get(post.id) || [],
      board: {
        id: post.boardId,
        name: post.boardName,
        slug: post.boardSlug,
      },
    }))

    return ok({
      items,
      total,
      hasMore: offset + items.length < total,
    })
  }

  /**
   * Get a single post with full details for public view
   * Only returns posts from public boards
   *
   * @param postId - Post ID to fetch
   * @param userIdentifier - Optional user identifier for reaction tracking
   * @returns Result containing post detail or null if not found/not public
   */
  async getPostDetail(
    postId: PostId,
    userIdentifier?: string
  ): Promise<Result<PublicPostDetail | null, PostError>> {
    const postResult = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: {
        board: true,
      },
    })

    if (!postResult || !postResult.board.isPublic) {
      return ok(null)
    }

    // Get tags
    const tagsResult = await db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(eq(postTags.postId, postId))

    // Get comments with reactions
    const commentsResult = await db.query.comments.findMany({
      where: eq(comments.postId, postId),
      with: {
        reactions: true,
      },
      orderBy: asc(comments.createdAt),
    })

    // Build nested comment tree
    const commentTree = buildCommentTree(commentsResult, userIdentifier)

    // Map to PublicComment format
    const mapToPublicComment = (node: (typeof commentTree)[0]): PublicComment => ({
      id: node.id as CommentId,
      content: node.content,
      authorName: node.authorName,
      memberId: node.memberId,
      createdAt: node.createdAt,
      parentId: node.parentId as CommentId | null,
      isTeamMember: node.isTeamMember,
      replies: node.replies.map(mapToPublicComment),
      reactions: node.reactions,
    })

    const rootComments = commentTree.map(mapToPublicComment)

    return ok({
      id: postResult.id,
      title: postResult.title,
      content: postResult.content,
      contentJson: postResult.contentJson,
      statusId: postResult.statusId,
      voteCount: postResult.voteCount,
      authorName: postResult.authorName,
      createdAt: postResult.createdAt,
      board: {
        id: postResult.board.id,
        name: postResult.board.name,
        slug: postResult.board.slug,
      },
      tags: tagsResult,
      comments: rootComments,
      officialResponse: postResult.officialResponse
        ? {
            content: postResult.officialResponse,
            authorName: postResult.officialResponseAuthorName,
            respondedAt: postResult.officialResponseAt!,
          }
        : null,
    })
  }

  /**
   * Get posts for roadmap view across all public boards
   *
   * @param statusIds - Array of status IDs to filter by
   * @returns Result containing roadmap posts
   */
  async getRoadmapPosts(statusIds: StatusId[]): Promise<Result<RoadmapPost[], PostError>> {
    if (statusIds.length === 0) {
      return ok([])
    }

    const result = await db
      .select({
        id: posts.id,
        title: posts.title,
        statusId: posts.statusId,
        voteCount: posts.voteCount,
        boardId: boards.id,
        boardName: boards.name,
        boardSlug: boards.slug,
      })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(eq(boards.isPublic, true), inArray(posts.statusId, statusIds)))
      .orderBy(desc(posts.voteCount))

    return ok(
      result.map((row) => ({
        id: row.id,
        title: row.title,
        statusId: row.statusId,
        voteCount: row.voteCount,
        board: {
          id: row.boardId,
          name: row.boardName,
          slug: row.boardSlug,
        },
      }))
    )
  }

  /**
   * Get paginated posts for roadmap view filtered by a single status
   *
   * @param params - Query parameters
   * @returns Result containing paginated roadmap posts
   */
  async getRoadmapPostsPaginated(params: {
    statusId: StatusId
    page?: number
    limit?: number
  }): Promise<Result<RoadmapPostListResult, PostError>> {
    const { statusId, page = 1, limit = 10 } = params
    const offset = (page - 1) * limit

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(eq(boards.isPublic, true), eq(posts.statusId, statusId)))

    const total = countResult[0]?.count ?? 0

    // Get paginated items
    const result = await db
      .select({
        id: posts.id,
        title: posts.title,
        statusId: posts.statusId,
        voteCount: posts.voteCount,
        boardId: boards.id,
        boardName: boards.name,
        boardSlug: boards.slug,
      })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(eq(boards.isPublic, true), eq(posts.statusId, statusId)))
      .orderBy(desc(posts.voteCount))
      .limit(limit)
      .offset(offset)

    const items = result.map((row) => ({
      id: row.id,
      title: row.title,
      statusId: row.statusId,
      voteCount: row.voteCount,
      board: {
        id: row.boardId,
        name: row.boardName,
        slug: row.boardSlug,
      },
    }))

    return ok({
      items,
      total,
      hasMore: offset + items.length < total,
    })
  }

  /**
   * Check if a user has voted on a post
   *
   * @param postId - Post ID to check
   * @param userIdentifier - User's identifier
   * @returns Result containing boolean
   */
  async hasUserVoted(postId: PostId, userIdentifier: string): Promise<Result<boolean, PostError>> {
    const vote = await db.query.votes.findFirst({
      where: and(eq(votes.postId, postId), eq(votes.userIdentifier, userIdentifier)),
    })

    return ok(!!vote)
  }

  /**
   * Get which posts a user has voted on from a list
   *
   * @param postIds - List of post IDs to check
   * @param userIdentifier - User's identifier
   * @returns Result containing Set of voted post IDs
   */
  async getUserVotedPostIds(
    postIds: PostId[],
    userIdentifier: string
  ): Promise<Result<Set<PostId>, PostError>> {
    if (postIds.length === 0) {
      return ok(new Set())
    }

    const result = await db
      .select({ postId: votes.postId })
      .from(votes)
      .where(and(inArray(votes.postId, postIds), eq(votes.userIdentifier, userIdentifier)))

    return ok(new Set(result.map((r) => r.postId)))
  }

  /**
   * Get all posts a user has voted on
   *
   * @param userIdentifier - User's identifier
   * @returns Result containing Set of all voted post IDs
   */
  async getAllUserVotedPostIds(userIdentifier: string): Promise<Result<Set<PostId>, PostError>> {
    const result = await db
      .select({ postId: votes.postId })
      .from(votes)
      .where(eq(votes.userIdentifier, userIdentifier))

    return ok(new Set(result.map((r) => r.postId)))
  }

  /**
   * Get board by post ID
   *
   * @param postId - Post ID to lookup
   * @returns Result containing Board or null
   */
  async getBoardByPostId(
    postId: PostId
  ): Promise<Result<import('@quackback/db').Board | null, PostError>> {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: { board: true },
    })

    return ok(post?.board || null)
  }
}

/**
 * Singleton instance of PublicPostService
 */
export const publicPostService = new PublicPostService()
