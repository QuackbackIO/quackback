import { eq, and, desc, asc, sql, ilike, or, inArray, gte, lte, isNull } from 'drizzle-orm'
import { db } from '../tenant-context'
import { posts, votes, comments, postTags } from '../schema/posts'
import { boards } from '../schema/boards'
import type {
  NewPost,
  Post,
  PostStatus,
  NewComment,
  Comment,
  InboxPostListParams,
  PostListItem,
  InboxPostListResult,
} from '../types'
import { buildCommentTree, type CommentNode } from './comments'

export async function createPost(data: NewPost): Promise<Post> {
  const [post] = await db.insert(posts).values(data).returning()
  return post
}

export async function getPostById(id: string): Promise<Post | undefined> {
  return db.query.posts.findFirst({
    where: eq(posts.id, id),
  })
}

export async function getPostWithDetails(id: string) {
  return db.query.posts.findFirst({
    where: eq(posts.id, id),
    with: {
      board: true,
      comments: {
        orderBy: (comments, { asc }) => [asc(comments.createdAt)],
      },
      tags: {
        with: {
          tag: true,
        },
      },
    },
  })
}

export async function getPostList(params: {
  boardId?: string
  organizationId?: string
  status?: string
  ownerId?: string
  search?: string
  sort?: 'newest' | 'oldest' | 'votes'
  page?: number
  limit?: number
}): Promise<{ items: Post[]; total: number }> {
  const { boardId, status, ownerId, search, sort = 'newest', page = 1, limit = 20 } = params

  const conditions = []

  if (boardId) {
    conditions.push(eq(posts.boardId, boardId))
  }
  if (status) {
    conditions.push(eq(posts.status, status as PostStatus))
  }
  if (ownerId) {
    conditions.push(eq(posts.ownerId, ownerId))
  }
  if (search) {
    conditions.push(or(ilike(posts.title, `%${search}%`), ilike(posts.content, `%${search}%`))!)
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const orderByMap = {
    newest: desc(posts.createdAt),
    oldest: asc(posts.createdAt),
    votes: desc(posts.voteCount),
  }

  const [items, countResult] = await Promise.all([
    db.query.posts.findMany({
      where: whereClause,
      orderBy: orderByMap[sort],
      limit,
      offset: (page - 1) * limit,
    }),
    db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .where(whereClause),
  ])

  return {
    items,
    total: Number(countResult[0].count),
  }
}

export async function updatePost(id: string, data: Partial<NewPost>): Promise<Post | undefined> {
  const [updated] = await db
    .update(posts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(posts.id, id))
    .returning()
  return updated
}

export async function updatePostStatus(id: string, status: PostStatus): Promise<Post | undefined> {
  return updatePost(id, { status })
}

export async function deletePost(id: string): Promise<void> {
  await db.delete(posts).where(eq(posts.id, id))
}

// Tag management for posts
export async function addTagsToPost(postId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return
  await db.insert(postTags).values(tagIds.map((tagId) => ({ postId, tagId })))
}

export async function removeTagsFromPost(postId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return
  await db.delete(postTags).where(and(eq(postTags.postId, postId), inArray(postTags.tagId, tagIds)))
}

export async function setPostTags(postId: string, tagIds: string[]): Promise<void> {
  // Remove all existing tags
  await db.delete(postTags).where(eq(postTags.postId, postId))
  // Add new tags
  await addTagsToPost(postId, tagIds)
}

// Vote functions
export async function toggleVote(postId: string, userIdentifier: string): Promise<boolean> {
  const existing = await db.query.votes.findFirst({
    where: and(eq(votes.postId, postId), eq(votes.userIdentifier, userIdentifier)),
  })

  if (existing) {
    await db.delete(votes).where(eq(votes.id, existing.id))
    await db
      .update(posts)
      .set({ voteCount: sql`${posts.voteCount} - 1` })
      .where(eq(posts.id, postId))
    return false
  } else {
    await db.insert(votes).values({ postId, userIdentifier })
    await db
      .update(posts)
      .set({ voteCount: sql`${posts.voteCount} + 1` })
      .where(eq(posts.id, postId))
    return true
  }
}

export async function getUserVotes(
  userIdentifier: string,
  postIds: string[]
): Promise<Set<string>> {
  if (postIds.length === 0) return new Set()

  const userVotes = await db.query.votes.findMany({
    where: and(eq(votes.userIdentifier, userIdentifier), inArray(votes.postId, postIds)),
  })

  return new Set(userVotes.map((v) => v.postId))
}

// Re-export CommentNode type for backwards compatibility
export type CommentWithRepliesAndReactions = CommentNode

// Comment functions (with nested threading support)
export async function getCommentsWithReplies(
  postId: string,
  userIdentifier?: string
): Promise<CommentWithRepliesAndReactions[]> {
  const allComments = await db.query.comments.findMany({
    where: eq(comments.postId, postId),
    with: {
      reactions: true,
    },
    orderBy: asc(comments.createdAt),
  })

  return buildCommentTree(allComments, userIdentifier)
}

export async function createComment(data: NewComment): Promise<Comment> {
  const [comment] = await db.insert(comments).values(data).returning()
  return comment
}

export async function deleteComment(id: string): Promise<void> {
  await db.delete(comments).where(eq(comments.id, id))
}

// Inbox query - fetches posts with board, tags, and comment count for the feedback inbox
export async function getInboxPostList(params: InboxPostListParams): Promise<InboxPostListResult> {
  const {
    organizationId,
    boardIds,
    status,
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
          where: eq(boards.organizationId, organizationId),
          columns: { id: true },
        })
      ).map((b) => b.id)

  if (orgBoardIds.length === 0) {
    return { items: [], total: 0, hasMore: false }
  }

  conditions.push(inArray(posts.boardId, orgBoardIds))

  // Status filter (multiple statuses = OR)
  if (status && status.length > 0) {
    conditions.push(inArray(posts.status, status))
  }

  // Owner filter
  if (ownerId === null) {
    conditions.push(isNull(posts.ownerId))
  } else if (ownerId) {
    conditions.push(eq(posts.ownerId, ownerId))
  }

  // Search filter
  if (search) {
    conditions.push(or(ilike(posts.title, `%${search}%`), ilike(posts.content, `%${search}%`))!)
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
  let postIdsWithTags: string[] | null = null
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

  // Get comment counts for all posts
  const postIds = rawPosts.map((p) => p.id)
  const commentCounts =
    postIds.length > 0
      ? await db
          .select({
            postId: comments.postId,
            count: sql<number>`count(*)`.as('count'),
          })
          .from(comments)
          .where(inArray(comments.postId, postIds))
          .groupBy(comments.postId)
      : []

  const commentCountMap = new Map(commentCounts.map((c) => [c.postId, Number(c.count)]))

  // Transform to PostListItem format
  const items: PostListItem[] = rawPosts.map((post) => ({
    ...post,
    board: post.board,
    tags: post.tags.map((pt) => pt.tag),
    commentCount: commentCountMap.get(post.id) ?? 0,
  }))

  const total = Number(countResult[0].count)

  return {
    items,
    total,
    hasMore: page * limit < total,
  }
}
