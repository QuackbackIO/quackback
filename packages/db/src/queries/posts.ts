import { eq, and, desc, asc, sql, inArray, gte, lte, isNull } from 'drizzle-orm'
import { db } from '../tenant-context'
import { posts, postTags } from '../schema/posts'
import { boards } from '../schema/boards'
import type { InboxPostListParams, PostListItem, InboxPostListResult, Post } from '../types'

// Inbox query - fetches posts with board, tags, and comment count for the feedback inbox
export async function getInboxPostList(params: InboxPostListParams): Promise<InboxPostListResult> {
  const {
    organizationId,
    boardIds,
    statusIds,
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

  // Always filter by organization (via boards)
  // First get board IDs for this organization
  const orgBoardIds = boardIds?.length
    ? boardIds
    : (
        await db.query.boards.findMany({
          where: eq(boards.workspaceId, organizationId),
          columns: { id: true },
        })
      ).map((b) => b.id)

  if (orgBoardIds.length === 0) {
    return { items: [], total: 0, hasMore: false }
  }

  conditions.push(inArray(posts.boardId, orgBoardIds))

  // Status filter (multiple statuses = OR)
  if (statusIds && statusIds.length > 0) {
    conditions.push(inArray(posts.statusId, statusIds))
  }

  // Owner filter
  if (ownerId === null) {
    conditions.push(isNull(posts.ownerId))
  } else if (ownerId) {
    conditions.push(eq(posts.ownerId, ownerId))
  }

  // Full-text search using tsvector (much faster than ILIKE)
  if (search) {
    conditions.push(sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${search})`)
  }

  // Date range filters
  if (dateFrom) {
    conditions.push(gte(posts.createdAt, dateFrom))
  }
  if (dateTo) {
    conditions.push(lte(posts.createdAt, dateTo))
  }

  // Min votes filter
  if (minVotes !== undefined && minVotes > 0) {
    conditions.push(gte(posts.voteCount, minVotes))
  }

  // Tag filter - posts must have at least one of the selected tags
  let postIdsWithTags: Post['id'][] | null = null
  if (tagIds && tagIds.length > 0) {
    const postsWithSelectedTags = await db
      .selectDistinct({ postId: postTags.postId })
      .from(postTags)
      .where(inArray(postTags.tagId, tagIds))

    postIdsWithTags = postsWithSelectedTags.map((p) => p.postId)

    if (postIdsWithTags.length === 0) {
      return { items: [], total: 0, hasMore: false }
    }
    conditions.push(inArray(posts.id, postIdsWithTags))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Sort order
  const orderByMap = {
    newest: desc(posts.createdAt),
    oldest: asc(posts.createdAt),
    votes: desc(posts.voteCount),
  }

  // Fetch posts with pagination
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
      },
    }),
    db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .where(whereClause),
  ])

  // Transform to PostListItem format (use denormalized commentCount from posts)
  const items: PostListItem[] = rawPosts.map((post) => ({
    ...post,
    board: post.board,
    tags: post.tags.map((pt) => pt.tag),
    commentCount: post.commentCount,
  }))

  const total = Number(countResult[0].count)

  return {
    items,
    total,
    hasMore: page * limit < total,
  }
}
