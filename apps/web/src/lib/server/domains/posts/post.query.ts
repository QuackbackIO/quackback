/**
 * Post Query Service
 *
 * Handles complex post queries including inbox listing and exports.
 */

import {
  db,
  posts,
  boards,
  postStatuses,
  postTags,
  postRoadmaps,
  tags,
  comments,
  principal,
  eq,
  and,
  inArray,
  desc,
  asc,
  sql,
  isNull,
  isNotNull,
} from '@/lib/server/db'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import type { PostId, BoardId, PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { buildCommentTree, toStatusChange, type CommentTreeNode } from '@/lib/shared'
import type {
  PostWithDetails,
  InboxPostListParams,
  InboxPostListResult,
  PostForExport,
  PinnedComment,
} from './post.types'

/**
 * Get a post with full details including board, tags, and comment count
 * Uses Drizzle query builder with parallel queries for compatibility across drivers.
 *
 * @param postId - Post ID to fetch
 * @returns Result containing the post with details or an error
 */
export async function getPostWithDetails(postId: PostId): Promise<PostWithDetails> {
  // Get the post with author relation
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: {
      author: {
        columns: { displayName: true },
        with: {
          user: {
            columns: { email: true },
          },
        },
      },
    },
  })
  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Get the board, tags, and roadmaps in parallel
  // Uses denormalized comment_count instead of counting comments
  const [board, postTagsResult, roadmapsResult] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, post.boardId) }),
    db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(eq(postTags.postId, postId)),
    db
      .select({ roadmapId: postRoadmaps.roadmapId })
      .from(postRoadmaps)
      .where(eq(postRoadmaps.postId, postId)),
  ])

  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${post.boardId} not found`)
  }

  // Fetch pinned comment data if exists
  let pinnedComment: PinnedComment | null = null
  if (post.pinnedCommentId) {
    const pinnedCommentData = await db.query.comments.findFirst({
      where: eq(comments.id, post.pinnedCommentId),
      with: {
        author: {
          columns: { displayName: true, avatarUrl: true, avatarKey: true },
        },
      },
    })

    if (pinnedCommentData && !pinnedCommentData.deletedAt) {
      // Compute avatar URL from principal fields
      let avatarUrl: string | null = null
      if (pinnedCommentData.author) {
        if (pinnedCommentData.author.avatarKey) {
          avatarUrl = getPublicUrlOrNull(pinnedCommentData.author.avatarKey)
        }
        if (!avatarUrl && pinnedCommentData.author.avatarUrl) {
          avatarUrl = pinnedCommentData.author.avatarUrl
        }
      }

      pinnedComment = {
        id: pinnedCommentData.id,
        content: pinnedCommentData.content,
        authorName: pinnedCommentData.author?.displayName ?? null,
        principalId: pinnedCommentData.principalId,
        avatarUrl,
        createdAt: pinnedCommentData.createdAt,
        isTeamMember: pinnedCommentData.isTeamMember,
      }
    }
  }

  // Resolve official response author name if needed
  let officialResponseAuthorName: string | null = null
  if (post.officialResponsePrincipalId) {
    const responderPrincipal = await db.query.principal.findFirst({
      where: eq(principal.id, post.officialResponsePrincipalId),
      columns: { displayName: true },
    })
    officialResponseAuthorName = responderPrincipal?.displayName ?? null
  }

  const postWithDetails: PostWithDetails = {
    ...post,
    board: {
      id: board.id,
      name: board.name,
      slug: board.slug,
    },
    tags: postTagsResult.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
    })),
    roadmapIds: roadmapsResult.map((r) => r.roadmapId),
    pinnedComment,
    authorName: post.author?.displayName ?? null,
    authorEmail: post.author?.user?.email ?? null,
    officialResponseAuthorName,
  }

  return postWithDetails
}

/**
 * Get comments with nested replies and reactions for a post
 *
 * @param postId - Post ID to fetch comments for
 * @param principalId - Principal ID to check for reactions (optional)
 * @returns Result containing nested comment tree or an error
 */
export async function getCommentsWithReplies(
  postId: PostId,
  principalId?: PrincipalId
): Promise<CommentTreeNode[]> {
  // Verify post exists and belongs to organization
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  const board = await db.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${post.boardId} not found`)
  }

  // Collect post IDs: this post + any posts merged into it
  const mergedPosts = await db.query.posts.findMany({
    where: and(eq(posts.canonicalPostId, postId), isNull(posts.deletedAt)),
    columns: { id: true },
  })
  const postIds = [postId, ...mergedPosts.map((p) => p.id)] as PostId[]

  // Get all comments with reactions, author info, and status changes (including from merged posts)
  const allComments = await db.query.comments.findMany({
    where: postIds.length === 1 ? eq(comments.postId, postId) : inArray(comments.postId, postIds),
    with: {
      reactions: true,
      author: {
        columns: { displayName: true },
      },
      statusChangeFrom: {
        columns: { name: true, color: true },
      },
      statusChangeTo: {
        columns: { name: true, color: true },
      },
    },
    orderBy: asc(comments.createdAt),
  })

  // Build nested tree using the utility function
  const commentsWithAuthor = allComments.map((c) => ({
    ...c,
    authorName: c.author?.displayName ?? null,
    statusChange: toStatusChange(c.statusChangeFrom, c.statusChangeTo),
  }))

  return buildCommentTree(commentsWithAuthor, principalId)
}

/**
 * List posts for admin inbox with advanced filtering
 *
 * @param params - Query parameters including filters, sort, and pagination
 * @returns Result containing inbox post list or an error
 */
export async function listInboxPosts(params: InboxPostListParams): Promise<InboxPostListResult> {
  const {
    boardIds,
    statusIds,
    statusSlugs,
    tagIds,
    ownerId,
    search,
    dateFrom,
    dateTo,
    minVotes,
    responded,
    updatedBefore,
    sort = 'newest',
    page = 1,
    limit = 20,
  } = params

  // Build conditions array
  const conditions = []

  // Exclude soft-deleted posts
  conditions.push(isNull(posts.deletedAt))

  // Exclude merged/duplicate posts from inbox listing
  conditions.push(isNull(posts.canonicalPostId))

  // Board filter
  if (boardIds?.length) {
    conditions.push(inArray(posts.boardId, boardIds))
  }

  // Status filter - use subquery to resolve slugs inline if needed
  if (statusSlugs && statusSlugs.length > 0) {
    // Use subquery to resolve status slugs to IDs in a single query
    const statusIdSubquery = db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(inArray(postStatuses.slug, statusSlugs))
    conditions.push(inArray(posts.statusId, statusIdSubquery))
  } else if (statusIds && statusIds.length > 0) {
    conditions.push(inArray(posts.statusId, statusIds))
  }

  // Owner filter
  if (ownerId === null) {
    conditions.push(sql`${posts.ownerPrincipalId} IS NULL`)
  } else if (ownerId) {
    conditions.push(eq(posts.ownerPrincipalId, ownerId as PrincipalId))
  }

  // Search filter
  // Full-text search using tsvector (much faster than ILIKE)
  if (search) {
    conditions.push(sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${search})`)
  }

  // Date range filters
  if (dateFrom) {
    conditions.push(sql`${posts.createdAt} >= ${dateFrom}`)
  }
  if (dateTo) {
    conditions.push(sql`${posts.createdAt} <= ${dateTo}`)
  }

  // Min votes filter
  if (minVotes !== undefined && minVotes > 0) {
    conditions.push(sql`${posts.voteCount} >= ${minVotes}`)
  }

  // Tag filter - use subquery to find posts with at least one of the selected tags
  if (tagIds && tagIds.length > 0) {
    const postIdsWithTagsSubquery = db
      .selectDistinct({ postId: postTags.postId })
      .from(postTags)
      .where(inArray(postTags.tagId, tagIds))
    conditions.push(inArray(posts.id, postIdsWithTagsSubquery))
  }

  // Responded filter - filter by team response state
  if (responded === 'responded') {
    conditions.push(isNotNull(posts.officialResponseAt))
  } else if (responded === 'unresponded') {
    conditions.push(isNull(posts.officialResponseAt))
  }

  // Updated before filter (for "stale" view)
  if (updatedBefore) {
    conditions.push(sql`${posts.updatedAt} < ${updatedBefore}`)
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Sort order
  const orderByMap = {
    newest: desc(posts.createdAt),
    oldest: asc(posts.createdAt),
    votes: desc(posts.voteCount),
  }

  // Fetch posts with pagination and count in parallel
  const [rawPosts, countResult] = await Promise.all([
    db.query.posts.findMany({
      where: whereClause,
      orderBy: orderByMap[sort],
      limit,
      offset: (page - 1) * limit,
      with: {
        board: {
          columns: { id: true, name: true, slug: true },
        },
        tags: {
          with: {
            tag: {
              columns: { id: true, name: true, color: true },
            },
          },
        },
        author: {
          columns: { displayName: true },
        },
      },
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(whereClause),
  ])

  // Transform to PostListItem format
  // Use denormalized commentCount field (maintained by database trigger)
  const items = rawPosts.map((post) => ({
    ...post,
    board: post.board,
    tags: post.tags.map((pt) => pt.tag),
    commentCount: post.commentCount,
    authorName: post.author?.displayName ?? null,
  }))

  const total = Number(countResult[0].count)

  return {
    items,
    total,
    hasMore: page * limit < total,
  }
}

/**
 * List posts for export (all posts with full details)
 *
 * @param boardId - Optional board ID to filter by
 * @returns Result containing posts for export or an error
 */
export async function listPostsForExport(boardId: BoardId | undefined): Promise<PostForExport[]> {
  // Get board IDs - either specific board or all boards
  const allBoardIds = boardId
    ? [boardId]
    : (
        await db.query.boards.findMany({
          columns: { id: true },
        })
      ).map((b) => b.id)

  if (allBoardIds.length === 0) {
    return []
  }

  // Get posts with board and tags (limit to prevent memory exhaustion)
  const MAX_EXPORT_POSTS = 10000
  const rawPosts = await db.query.posts.findMany({
    where: inArray(posts.boardId, allBoardIds),
    orderBy: desc(posts.createdAt),
    limit: MAX_EXPORT_POSTS,
    with: {
      board: {
        columns: { id: true, name: true, slug: true },
      },
      tags: {
        with: {
          tag: {
            columns: { id: true, name: true, color: true },
          },
        },
      },
      author: {
        columns: { displayName: true },
        with: {
          user: {
            columns: { email: true },
          },
        },
      },
    },
  })

  // Get status details for posts that have a statusId (use Set for O(n) deduplication)
  const postStatusIds = [...new Set(rawPosts.filter((p) => p.statusId).map((p) => p.statusId!))]

  const statusDetails =
    postStatusIds.length > 0
      ? await db.query.postStatuses.findMany({
          where: inArray(postStatuses.id, postStatusIds),
        })
      : []

  const statusMap = new Map(statusDetails.map((s) => [s.id, { name: s.name, color: s.color }]))

  // Transform to export format
  return rawPosts.map(
    (post): PostForExport => ({
      id: post.id,
      title: post.title,
      content: post.content,
      statusId: post.statusId,
      voteCount: post.voteCount,
      authorName: post.author?.displayName ?? null,
      authorEmail: post.author?.user?.email ?? null,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      board: {
        id: post.board.id,
        name: post.board.name,
        slug: post.board.slug,
      },
      tags: post.tags.map((pt) => pt.tag),
      statusDetails: post.statusId ? statusMap.get(post.statusId) : undefined,
    })
  )
}
