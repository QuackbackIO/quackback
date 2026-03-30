/**
 * Post Query Service
 *
 * Handles post detail and comment queries.
 * - post.inbox.ts  - Inbox listing with filtering and pagination
 * - post.export.ts - Export and feedback source queries
 */

import {
  db,
  posts,
  boards,
  postTags,
  postRoadmaps,
  tags,
  comments,
  eq,
  and,
  inArray,
  asc,
  isNull,
} from '@/lib/server/db'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { type PostId, type PrincipalId } from '@featurepool/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { buildCommentTree, toStatusChange, type CommentTreeNode } from '@/lib/shared'
import type { PostWithDetails, PinnedComment } from './post.types'

/**
 * Get a post with full details including board, tags, and comment count
 * Uses Drizzle query builder with parallel queries for compatibility across drivers.
 *
 * @param postId - Post ID to fetch
 * @returns Result containing the post with details or an error
 */
export async function getPostWithDetails(postId: PostId): Promise<PostWithDetails> {
  // Get the post with author relation (exclude internal/heavy fields)
  const post = await db.query.posts.findFirst({
    columns: {
      id: true,
      boardId: true,
      title: true,
      content: true,
      contentJson: true,
      principalId: true,
      statusId: true,
      ownerPrincipalId: true,
      voteCount: true,
      commentCount: true,
      pinnedCommentId: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      isCommentsLocked: true,
      moderationState: true,
      canonicalPostId: true,
      mergedAt: true,
      summaryJson: true,
      summaryUpdatedAt: true,
    },
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
  // Uses denormalized comment_count (maintained by comment.service.ts)
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

  // Cast needed: columns selection omits heavy internal fields (embedding, searchVector,
  // etc.) that no caller reads, but PostWithDetails extends the full Post type.
  const postWithDetails = {
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
  } as unknown as PostWithDetails

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
