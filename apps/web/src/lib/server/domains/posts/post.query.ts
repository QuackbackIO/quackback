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
  eq,
  and,
  inArray,
  desc,
  asc,
  sql,
  isNull,
} from '@/lib/server/db'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import type { PostId, BoardId, MemberId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { buildCommentTree, type CommentTreeNode } from '@/lib/shared'
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
        with: {
          user: {
            columns: { name: true, email: true },
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
          with: {
            user: {
              columns: { name: true, image: true, imageKey: true },
            },
          },
        },
      },
    })

    if (pinnedCommentData && !pinnedCommentData.deletedAt) {
      // Compute avatar URL
      let avatarUrl: string | null = null
      if (pinnedCommentData.author?.user) {
        const user = pinnedCommentData.author.user
        if (user.imageKey) {
          avatarUrl = getPublicUrlOrNull(user.imageKey)
        }
        if (!avatarUrl && user.image) {
          avatarUrl = user.image
        }
      }

      pinnedComment = {
        id: pinnedCommentData.id,
        content: pinnedCommentData.content,
        authorName: pinnedCommentData.author?.user?.name ?? null,
        memberId: pinnedCommentData.memberId,
        avatarUrl,
        createdAt: pinnedCommentData.createdAt,
        isTeamMember: pinnedCommentData.isTeamMember,
      }
    }
  }

  // Resolve official response author name if needed
  let officialResponseAuthorName: string | null = null
  if (post.officialResponseMemberId) {
    // Import member table for the query
    const { member: memberTable } = await import('@/lib/server/db')
    const responderMember = await db.query.member.findFirst({
      where: eq(memberTable.id, post.officialResponseMemberId),
      columns: {},
      with: { user: { columns: { name: true } } },
    })
    officialResponseAuthorName = responderMember?.user?.name ?? null
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
    authorName: post.author?.user?.name ?? null,
    authorEmail: post.author?.user?.email ?? null,
    officialResponseAuthorName,
  }

  return postWithDetails
}

/**
 * Get comments with nested replies and reactions for a post
 *
 * @param postId - Post ID to fetch comments for
 * @param memberId - Member ID to check for reactions (optional)
 * @returns Result containing nested comment tree or an error
 */
export async function getCommentsWithReplies(
  postId: PostId,
  memberId?: MemberId
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

  // Get all comments with reactions and author info
  const allComments = await db.query.comments.findMany({
    where: eq(comments.postId, postId),
    with: {
      reactions: true,
      author: {
        with: {
          user: {
            columns: { name: true },
          },
        },
      },
    },
    orderBy: asc(comments.createdAt),
  })

  // Build nested tree using the utility function
  // Map to include authorName from the member->user relation
  const commentsWithAuthor = allComments.map((c) => ({
    ...c,
    authorName: c.author?.user?.name ?? null,
  }))
  const commentTree = buildCommentTree(commentsWithAuthor, memberId)

  return commentTree
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
    conditions.push(sql`${posts.ownerMemberId} IS NULL`)
  } else if (ownerId) {
    conditions.push(eq(posts.ownerMemberId, ownerId as MemberId))
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
          with: {
            user: {
              columns: { name: true },
            },
          },
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
    authorName: post.author?.user?.name ?? null,
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
  // Build conditions
  const conditions = []

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

  conditions.push(inArray(posts.boardId, allBoardIds))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Get posts with board and tags (limit to prevent memory exhaustion)
  const MAX_EXPORT_POSTS = 10000
  const rawPosts = await db.query.posts.findMany({
    where: whereClause,
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
        with: {
          user: {
            columns: { name: true, email: true },
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
  const exportPosts: PostForExport[] = rawPosts.map((post) => ({
    id: post.id,
    title: post.title,
    content: post.content,
    statusId: post.statusId,
    voteCount: post.voteCount,
    authorName: post.author?.user?.name ?? null,
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
  }))

  return exportPosts
}
