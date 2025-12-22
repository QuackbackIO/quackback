import { eq, and, desc, asc, sql, inArray, isNull } from 'drizzle-orm'
import type { BoardId, PostId, TagId, CommentId, MemberId, StatusId } from '@quackback/ids'
import { db } from '../client'
import { boards, tags } from '../schema/boards'
import { posts, votes, comments, postTags, commentReactions } from '../schema/posts'
import { REACTION_EMOJIS, type Board } from '../types'
import { buildCommentTree, aggregateReactions } from './comments'

// Types for public queries
export interface BoardWithStats extends Board {
  postCount: number
}

export interface PublicPostListParams {
  boardId: BoardId
  search?: string
  statusIds?: StatusId[]
  sort?: 'newest' | 'oldest' | 'votes'
  page?: number
  limit?: number
}

export interface PublicPostListItem {
  id: PostId
  title: string
  content: string
  statusId: StatusId | null
  voteCount: number
  authorName: string | null
  /** Member ID for fetching avatar data (null for anonymous posts) */
  memberId: MemberId | null
  createdAt: Date
  commentCount: number
  tags: { id: TagId; name: string; color: string }[]
  board?: { id: BoardId; name: string; slug: string }
}

export interface AllBoardsPostListParams {
  boardSlug?: string
  search?: string
  statusIds?: StatusId[]
  sort?: 'top' | 'new' | 'trending'
  page?: number
  limit?: number
}

export interface PublicPostListResult {
  items: PublicPostListItem[]
  total: number
  hasMore: boolean
}

export interface OfficialResponse {
  content: string
  authorName: string | null
  respondedAt: Date
}

export interface PublicPostDetail {
  id: PostId
  title: string
  content: string
  contentJson: unknown
  statusId: StatusId | null
  voteCount: number
  authorName: string | null
  createdAt: Date
  board: { id: BoardId; name: string; slug: string }
  tags: { id: TagId; name: string; color: string }[]
  comments: PublicComment[]
  officialResponse: OfficialResponse | null
}

export interface CommentReactionCount {
  emoji: string
  count: number
  hasReacted: boolean
}

export interface PublicComment {
  id: CommentId
  content: string
  authorName: string | null
  /** Member ID for fetching avatar data (null for anonymous comments) */
  memberId: MemberId | null
  createdAt: Date
  parentId: CommentId | null
  isTeamMember: boolean
  replies: PublicComment[]
  reactions: CommentReactionCount[]
}

export interface RoadmapPost {
  id: PostId
  title: string
  statusId: StatusId | null
  voteCount: number
  board: { id: BoardId; name: string; slug: string }
}

/**
 * Get public boards with post counts
 */
export async function getPublicBoardsWithStats(): Promise<BoardWithStats[]> {
  // Count only non-deleted posts
  const result = await db
    .select({
      board: boards,
      postCount: sql<number>`count(${posts.id}) FILTER (WHERE ${posts.deletedAt} IS NULL)::int`,
    })
    .from(boards)
    .leftJoin(posts, eq(posts.boardId, boards.id))
    .where(eq(boards.isPublic, true))
    .groupBy(boards.id)
    .orderBy(asc(boards.name))

  return result.map((row) => ({
    ...row.board,
    postCount: row.postCount || 0,
  }))
}

/**
 * Get a single public board by slug
 */
export async function getPublicBoardBySlug(slug: string): Promise<Board | undefined> {
  return db.query.boards.findFirst({
    where: and(eq(boards.slug, slug), eq(boards.isPublic, true)),
  })
}

/**
 * Get a board by ID (for public post submissions)
 */
export async function getPublicBoardById(boardId: BoardId): Promise<Board | undefined> {
  return db.query.boards.findFirst({
    where: eq(boards.id, boardId),
  })
}

/**
 * Get posts for a public board with pagination
 */
export async function getPublicPostList(
  params: PublicPostListParams
): Promise<PublicPostListResult> {
  const { boardId, search, statusIds, sort = 'newest', page = 1, limit = 20 } = params
  const offset = (page - 1) * limit

  // Build where conditions
  // Exclude soft-deleted posts
  const conditions = [eq(posts.boardId, boardId), isNull(posts.deletedAt)]

  if (statusIds && statusIds.length > 0) {
    conditions.push(inArray(posts.statusId, statusIds))
  }

  // Full-text search using tsvector (much faster than ILIKE)
  if (search) {
    conditions.push(sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${search})`)
  }

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(...conditions))

  const total = countResult?.count || 0

  // Get posts with comment count
  const orderBy =
    sort === 'votes'
      ? desc(posts.voteCount)
      : sort === 'oldest'
        ? asc(posts.createdAt)
        : desc(posts.createdAt)

  const postsResult = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      statusId: posts.statusId,
      voteCount: posts.voteCount,
      commentCount: posts.commentCount,
      authorName: posts.authorName,
      memberId: posts.memberId,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)

  // Get post IDs for batch queries
  const postIds = postsResult.map((p) => p.id)

  // Get tags for all posts
  const tagsResult =
    postIds.length > 0
      ? await db
          .select({
            postId: postTags.postId,
            id: tags.id,
            name: tags.name,
            color: tags.color,
          })
          .from(postTags)
          .innerJoin(tags, eq(tags.id, postTags.tagId))
          .where(inArray(postTags.postId, postIds))
      : []

  // Group tags by post
  const tagsByPost = new Map<PostId, { id: TagId; name: string; color: string }[]>()
  for (const row of tagsResult) {
    const existing = tagsByPost.get(row.postId) || []
    existing.push({ id: row.id, name: row.name, color: row.color })
    tagsByPost.set(row.postId, existing)
  }

  const items: PublicPostListItem[] = postsResult.map((post) => ({
    ...post,
    tags: tagsByPost.get(post.id) || [],
  }))

  return {
    items,
    total,
    hasMore: offset + items.length < total,
  }
}

/**
 * Get posts from all public boards
 * Optionally filter by board slug
 */
export async function getPublicPostListAllBoards(
  params: AllBoardsPostListParams
): Promise<PublicPostListResult> {
  const { boardSlug, search, statusIds, sort = 'top', page = 1, limit = 20 } = params
  const offset = (page - 1) * limit

  // Build where conditions
  // Exclude soft-deleted posts
  const conditions = [eq(boards.isPublic, true), isNull(posts.deletedAt)]

  if (boardSlug) {
    conditions.push(eq(boards.slug, boardSlug))
  }

  if (statusIds && statusIds.length > 0) {
    conditions.push(inArray(posts.statusId, statusIds))
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
  // 'top' = most votes, 'new' = newest, 'trending' = votes weighted by recency
  const orderBy =
    sort === 'new'
      ? desc(posts.createdAt)
      : sort === 'trending'
        ? sql`(${posts.voteCount} / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - ${posts.createdAt})) / 86400)) DESC`
        : desc(posts.voteCount) // 'top' is default

  const postsResult = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      statusId: posts.statusId,
      voteCount: posts.voteCount,
      commentCount: posts.commentCount,
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

  // Get post IDs for batch queries
  const postIds = postsResult.map((p) => p.id)

  // Get tags for all posts
  const tagsResult =
    postIds.length > 0
      ? await db
          .select({
            postId: postTags.postId,
            id: tags.id,
            name: tags.name,
            color: tags.color,
          })
          .from(postTags)
          .innerJoin(tags, eq(tags.id, postTags.tagId))
          .where(inArray(postTags.postId, postIds))
      : []

  // Group tags by post
  const tagsByPost = new Map<PostId, { id: TagId; name: string; color: string }[]>()
  for (const row of tagsResult) {
    const existing = tagsByPost.get(row.postId) || []
    existing.push({ id: row.id, name: row.name, color: row.color })
    tagsByPost.set(row.postId, existing)
  }

  const items: PublicPostListItem[] = postsResult.map((post) => ({
    id: post.id,
    title: post.title,
    content: post.content,
    statusId: post.statusId,
    voteCount: post.voteCount,
    commentCount: post.commentCount,
    authorName: post.authorName,
    memberId: post.memberId,
    createdAt: post.createdAt,
    tags: tagsByPost.get(post.id) || [],
    board: {
      id: post.boardId,
      name: post.boardName,
      slug: post.boardSlug,
    },
  }))

  return {
    items,
    total,
    hasMore: offset + items.length < total,
  }
}

/**
 * Get a single post with details for public view
 */
export async function getPublicPostDetail(
  postId: PostId,
  userIdentifier?: string
): Promise<PublicPostDetail | null> {
  // Get post with board (exclude deleted posts)
  const post = await db.query.posts.findFirst({
    where: and(eq(posts.id, postId), isNull(posts.deletedAt)),
    with: {
      board: true,
    },
  })

  if (!post || !post.board.isPublic) {
    return null
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

  // Get comments with reactions (include deleted comments with placeholder)
  const commentsResult = await db.query.comments.findMany({
    where: eq(comments.postId, postId),
    with: {
      reactions: true,
    },
    orderBy: asc(comments.createdAt),
  })

  // Filter out deleted comments content (but keep in tree for thread integrity)
  const processedComments = commentsResult.map((comment) => ({
    ...comment,
    // Replace content with placeholder for deleted comments
    content: comment.deletedAt ? '[This comment has been deleted]' : comment.content,
    // Clear author info for deleted comments
    authorName: comment.deletedAt ? null : comment.authorName,
    memberId: comment.deletedAt ? null : comment.memberId,
  }))

  // Build nested comment tree using shared helper
  const commentTree = buildCommentTree(processedComments, userIdentifier)

  // Map to PublicComment format
  const mapToPublicComment = (node: (typeof commentTree)[0]): PublicComment => ({
    id: node.id,
    content: node.content,
    authorName: node.authorName,
    memberId: node.memberId,
    createdAt: node.createdAt,
    parentId: node.parentId,
    isTeamMember: node.isTeamMember,
    replies: node.replies.map(mapToPublicComment),
    reactions: node.reactions,
  })

  const rootComments = commentTree.map(mapToPublicComment)

  return {
    id: post.id,
    title: post.title,
    content: post.content,
    contentJson: post.contentJson,
    statusId: post.statusId,
    voteCount: post.voteCount,
    authorName: post.authorName,
    createdAt: post.createdAt,
    board: {
      id: post.board.id,
      name: post.board.name,
      slug: post.board.slug,
    },
    tags: tagsResult,
    comments: rootComments,
    officialResponse: post.officialResponse
      ? {
          content: post.officialResponse,
          authorName: post.officialResponseAuthorName,
          respondedAt: post.officialResponseAt!,
        }
      : null,
  }
}

/**
 * Get posts for roadmap view across all public boards
 * @param statusIds - Array of status IDs to filter by
 */
export async function getRoadmapPosts(statusIds: StatusId[]): Promise<RoadmapPost[]> {
  if (statusIds.length === 0) {
    return []
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
    .where(
      and(eq(boards.isPublic, true), inArray(posts.statusId, statusIds), isNull(posts.deletedAt))
    )
    .orderBy(desc(posts.voteCount))

  return result.map((row) => ({
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
}

/**
 * Check if a user has voted on a post
 */
export async function hasUserVotedOnPost(postId: PostId, userIdentifier: string): Promise<boolean> {
  const vote = await db.query.votes.findFirst({
    where: and(eq(votes.postId, postId), eq(votes.userIdentifier, userIdentifier)),
  })
  return !!vote
}

/**
 * Get which posts a user has voted on from a list
 */
export async function getUserVotedPostIds(
  postIds: PostId[],
  userIdentifier: string
): Promise<Set<PostId>> {
  if (postIds.length === 0) {
    return new Set()
  }

  const result = await db
    .select({ postId: votes.postId })
    .from(votes)
    .where(and(inArray(votes.postId, postIds), eq(votes.userIdentifier, userIdentifier)))

  return new Set(result.map((r) => r.postId))
}

/**
 * Get all post IDs a user has voted on.
 */
export async function getAllUserVotedPostIds(userIdentifier: string): Promise<Set<PostId>> {
  const result = await db
    .select({ postId: votes.postId })
    .from(votes)
    .where(eq(votes.userIdentifier, userIdentifier))

  return new Set(result.map((r) => r.postId))
}

/**
 * Toggle vote on a post (add or remove)
 */
export async function togglePublicVote(
  postId: PostId,
  userIdentifier: string
): Promise<{ voted: boolean; newCount: number }> {
  // Check if vote exists
  const existingVote = await db.query.votes.findFirst({
    where: and(eq(votes.postId, postId), eq(votes.userIdentifier, userIdentifier)),
  })

  if (existingVote) {
    // Remove vote
    await db
      .delete(votes)
      .where(and(eq(votes.postId, postId), eq(votes.userIdentifier, userIdentifier)))

    // Decrement vote count
    const [updated] = await db
      .update(posts)
      .set({ voteCount: sql`${posts.voteCount} - 1` })
      .where(eq(posts.id, postId))
      .returning({ voteCount: posts.voteCount })

    return { voted: false, newCount: updated?.voteCount || 0 }
  } else {
    // Add vote
    await db.insert(votes).values({ postId, userIdentifier })

    // Increment vote count
    const [updated] = await db
      .update(posts)
      .set({ voteCount: sql`${posts.voteCount} + 1` })
      .where(eq(posts.id, postId))
      .returning({ voteCount: posts.voteCount })

    return { voted: true, newCount: updated?.voteCount || 0 }
  }
}

/**
 * Get board by post ID
 */
export async function getBoardByPostId(postId: PostId): Promise<Board | null> {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: { board: true },
  })
  return post?.board || null
}

/**
 * Check if a comment exists for a given post
 */
export async function commentExistsForPost(postId: PostId, commentId: CommentId): Promise<boolean> {
  const comment = await db.query.comments.findFirst({
    where: and(eq(comments.id, commentId), eq(comments.postId, postId)),
  })
  return !!comment
}

/**
 * Add a comment to a post
 * For authenticated users, pass memberId and authorName (from member record)
 * For anonymous users, pass authorName and authorEmail (memberId should be undefined)
 */
export async function addPublicComment(
  postId: PostId,
  content: string,
  authorName: string | null,
  authorEmail: string | null,
  parentId?: CommentId,
  memberId?: MemberId
): Promise<PublicComment> {
  const [comment] = await db
    .insert(comments)
    .values({
      postId,
      content,
      authorName,
      authorEmail,
      parentId: parentId || null,
      memberId: memberId || null,
    })
    .returning()

  return {
    id: comment.id,
    content: comment.content,
    authorName: comment.authorName,
    memberId: comment.memberId,
    createdAt: comment.createdAt,
    parentId: comment.parentId,
    isTeamMember: comment.isTeamMember,
    replies: [],
    reactions: [],
  }
}

/**
 * Toggle a reaction on a comment (add if not exists, remove if exists)
 */
export async function toggleCommentReaction(
  commentId: CommentId,
  userIdentifier: string,
  emoji: string
): Promise<{ added: boolean; reactions: CommentReactionCount[] }> {
  // Check if reaction exists
  const existing = await db.query.commentReactions.findFirst({
    where: and(
      eq(commentReactions.commentId, commentId),
      eq(commentReactions.userIdentifier, userIdentifier),
      eq(commentReactions.emoji, emoji)
    ),
  })

  if (existing) {
    // Remove reaction
    await db.delete(commentReactions).where(eq(commentReactions.id, existing.id))
  } else {
    // Add reaction
    await db.insert(commentReactions).values({ commentId, userIdentifier, emoji })
  }

  // Get updated reaction counts using shared helper
  const allReactions = await db.query.commentReactions.findMany({
    where: eq(commentReactions.commentId, commentId),
  })

  return {
    added: !existing,
    reactions: aggregateReactions(allReactions, userIdentifier),
  }
}

/**
 * Get available reaction emojis
 */
export function getReactionEmojis(): readonly string[] {
  return REACTION_EMOJIS
}
