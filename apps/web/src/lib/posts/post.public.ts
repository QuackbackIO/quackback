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
  commentReactions,
  votes,
  postStatuses,
  postRoadmaps,
  roadmaps,
  member as memberTable,
  user as userTable,
} from '@/lib/db'
import type { PostId, StatusId, TagId, CommentId } from '@quackback/ids'
import { buildCommentTree } from '@/lib/shared'
import type {
  PublicPostListResult,
  RoadmapPost,
  RoadmapPostListResult,
  PublicPostDetail,
  PublicComment,
  PinnedComment,
} from './post.types'

/**
 * Compute avatar URL from user image data.
 * Blob data takes precedence over OAuth image URL.
 */
function computeAvatarUrl(data: {
  imageBlob: Buffer | null
  imageType: string | null
  image: string | null
}): string | null {
  if (data.imageBlob && data.imageType) {
    const base64 = Buffer.from(data.imageBlob).toString('base64')
    return `data:${data.imageType};base64,${base64}`
  }
  return data.image ?? null
}

/**
 * Determine sort order for post queries.
 */
function getPostSortOrder(sort: 'top' | 'new' | 'trending') {
  switch (sort) {
    case 'new':
      return desc(posts.createdAt)
    case 'trending':
      return sql`(${posts.voteCount} / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - ${posts.createdAt})) / 86400)) DESC`
    case 'top':
    default:
      return desc(posts.voteCount)
  }
}

/**
 * List posts for public portal (no authentication required)
 *
 * @param params - Query parameters including boardSlug, search, statusIds/statusSlugs, sort, pagination
 * @returns Public post list
 */
export async function listPublicPosts(params: {
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
}): Promise<PublicPostListResult> {
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

  // Tag filter - use subquery to find posts with at least one of the selected tags
  if (tagIds && tagIds.length > 0) {
    const postIdsWithTagsSubquery = db
      .selectDistinct({ postId: postTags.postId })
      .from(postTags)
      .where(inArray(postTags.tagId, tagIds))
    conditions.push(inArray(posts.id, postIdsWithTagsSubquery))
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

  const orderBy = getPostSortOrder(sort)

  // Get posts with board info
  // Use denormalized commentCount field (maintained by database trigger)
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

  const postIds = postsResult.map((p) => p.id)

  // Batch fetch tags
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

  // Build lookup map for tags
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
    commentCount: post.commentCount,
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
 * Get a single post with full details for public view
 * Only returns posts from public boards
 *
 * @param postId - Post ID to fetch
 * @param userIdentifier - Optional user identifier for reaction tracking
 * @returns Post detail or null if not found/not public
 */
export async function getPublicPostDetail(
  postId: PostId,
  userIdentifier?: string
): Promise<PublicPostDetail | null> {
  const postResult = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: {
      board: true,
    },
  })

  if (!postResult || !postResult.board.isPublic) {
    return null
  }

  // Fetch post author's avatar if memberId exists
  let authorAvatarUrl: string | null = null
  if (postResult.memberId) {
    const authorData = await db
      .select({
        imageBlob: userTable.imageBlob,
        imageType: userTable.imageType,
        image: userTable.image,
      })
      .from(memberTable)
      .innerJoin(userTable, eq(memberTable.userId, userTable.id))
      .where(eq(memberTable.id, postResult.memberId))
      .limit(1)

    if (authorData.length > 0) {
      authorAvatarUrl = computeAvatarUrl(authorData[0])
    }
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

  // Get roadmaps this post is in (only public roadmaps)
  const roadmapsResult = await db
    .select({
      id: roadmaps.id,
      name: roadmaps.name,
      slug: roadmaps.slug,
    })
    .from(postRoadmaps)
    .innerJoin(roadmaps, eq(roadmaps.id, postRoadmaps.roadmapId))
    .where(and(eq(postRoadmaps.postId, postId), eq(roadmaps.isPublic, true)))

  // Get comments with reactions and avatar data
  // Use raw query to LEFT JOIN member and user tables for avatar URLs
  const commentsWithAvatars = await db
    .select({
      id: comments.id,
      postId: comments.postId,
      parentId: comments.parentId,
      memberId: comments.memberId,
      authorId: comments.authorId,
      authorName: comments.authorName,
      authorEmail: comments.authorEmail,
      content: comments.content,
      isTeamMember: comments.isTeamMember,
      createdAt: comments.createdAt,
      deletedAt: comments.deletedAt,
      // Avatar data from user table (via member)
      imageBlob: userTable.imageBlob,
      imageType: userTable.imageType,
      image: userTable.image,
    })
    .from(comments)
    .leftJoin(memberTable, eq(comments.memberId, memberTable.id))
    .leftJoin(userTable, eq(memberTable.userId, userTable.id))
    .where(eq(comments.postId, postId))
    .orderBy(asc(comments.createdAt))

  // Fetch reactions separately (simpler than trying to aggregate in single query)
  const commentIds = commentsWithAvatars.map((c) => c.id)
  const reactionsResult =
    commentIds.length > 0
      ? await db.query.commentReactions.findMany({
          where: inArray(commentReactions.commentId, commentIds),
        })
      : []

  // Group reactions by comment ID
  const reactionsByComment = new Map<string, Array<{ emoji: string; userIdentifier: string }>>()
  for (const reaction of reactionsResult) {
    const existing = reactionsByComment.get(reaction.commentId) || []
    existing.push({ emoji: reaction.emoji, userIdentifier: reaction.userIdentifier })
    reactionsByComment.set(reaction.commentId, existing)
  }

  // Build comments with reactions and computed avatar URLs
  const commentsResult = commentsWithAvatars.map((comment) => ({
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId,
    memberId: comment.memberId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    authorEmail: comment.authorEmail,
    content: comment.content,
    isTeamMember: comment.isTeamMember,
    createdAt: comment.createdAt,
    avatarUrl: computeAvatarUrl(comment),
    reactions: reactionsByComment.get(comment.id) || [],
  }))

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
    avatarUrl: node.avatarUrl ?? null,
    replies: node.replies.map(mapToPublicComment),
    reactions: node.reactions,
  })

  const rootComments = commentTree.map(mapToPublicComment)

  // Build pinned comment data if exists
  let pinnedComment: PinnedComment | null = null
  if (postResult.pinnedCommentId) {
    const pinnedCommentData = commentsWithAvatars.find((c) => c.id === postResult.pinnedCommentId)
    if (pinnedCommentData && !pinnedCommentData.deletedAt) {
      pinnedComment = {
        id: pinnedCommentData.id as CommentId,
        content: pinnedCommentData.content,
        authorName: pinnedCommentData.authorName,
        memberId: pinnedCommentData.memberId,
        avatarUrl: computeAvatarUrl(pinnedCommentData),
        createdAt: pinnedCommentData.createdAt,
        isTeamMember: pinnedCommentData.isTeamMember,
      }
    }
  }

  return {
    id: postResult.id,
    title: postResult.title,
    content: postResult.content,
    contentJson: postResult.contentJson,
    statusId: postResult.statusId,
    voteCount: postResult.voteCount,
    authorName: postResult.authorName,
    memberId: postResult.memberId,
    authorAvatarUrl,
    createdAt: postResult.createdAt,
    board: {
      id: postResult.board.id,
      name: postResult.board.name,
      slug: postResult.board.slug,
    },
    tags: tagsResult,
    roadmaps: roadmapsResult,
    comments: rootComments,
    officialResponse: postResult.officialResponse
      ? {
          content: postResult.officialResponse,
          authorName: postResult.officialResponseAuthorName,
          respondedAt: postResult.officialResponseAt!,
        }
      : null,
    pinnedComment,
    pinnedCommentId: (postResult.pinnedCommentId as CommentId) ?? null,
  }
}

/**
 * Get posts for roadmap view across all public boards
 *
 * @param statusIds - Array of status IDs to filter by
 * @returns Roadmap posts
 */
export async function getPublicRoadmapPosts(statusIds: StatusId[]): Promise<RoadmapPost[]> {
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
    .where(and(eq(boards.isPublic, true), inArray(posts.statusId, statusIds)))
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
 * Get paginated posts for roadmap view filtered by a single status
 *
 * @param params - Query parameters
 * @returns Paginated roadmap posts
 */
export async function getPublicRoadmapPostsPaginated(params: {
  statusId: StatusId
  page?: number
  limit?: number
}): Promise<RoadmapPostListResult> {
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

  return {
    items,
    total,
    hasMore: offset + items.length < total,
  }
}

/**
 * Check if a user has voted on a post
 *
 * @param postId - Post ID to check
 * @param userIdentifier - User's identifier
 * @returns True if user has voted
 */
export async function hasUserVoted(postId: PostId, userIdentifier: string): Promise<boolean> {
  const vote = await db.query.votes.findFirst({
    where: and(eq(votes.postId, postId), eq(votes.userIdentifier, userIdentifier)),
  })

  return !!vote
}

/**
 * Get which posts a user has voted on from a list
 *
 * @param postIds - List of post IDs to check
 * @param userIdentifier - User's identifier
 * @returns Set of voted post IDs
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
 * Get all posts a user has voted on
 *
 * @param userIdentifier - User's identifier
 * @returns Set of all voted post IDs
 */
export async function getAllUserVotedPostIds(userIdentifier: string): Promise<Set<PostId>> {
  const result = await db
    .select({ postId: votes.postId })
    .from(votes)
    .where(eq(votes.userIdentifier, userIdentifier))

  return new Set(result.map((r) => r.postId))
}

/**
 * Get board by post ID
 *
 * @param postId - Post ID to lookup
 * @returns Board or null
 */
export async function getBoardByPostId(
  postId: PostId
): Promise<import('@quackback/db').Board | null> {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: { board: true },
  })

  return post?.board || null
}
