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
  postTagAssignments,
  postRoadmaps,
  postTags,
  postComments,
  eq,
  and,
  inArray,
  asc,
  isNull,
} from '@/lib/server/db'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { realEmail } from '@/lib/shared/anonymous-email'
import { type PostId, type PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { buildCommentTree, toStatusChange, type CommentTreeNode } from '@/lib/shared'
import type { PostWithDetails, PinnedComment } from './post.types'
import { hydrateMentions } from './hydrate-mentions'
import type { JSONContent } from '@tiptap/core'
import type { TiptapContent } from '@/lib/shared/db-types'

/**
 * Get a post with full details including board, tags, and comment count.
 * Uses Drizzle query builder with parallel queries for compatibility across drivers.
 *
 * SECURITY: this function returns the full board object alongside the
 * post and does NOT apply `canViewBoard` / `canViewPost`. All current
 * callers are team-authed paths (admin REST, MCP, merge action,
 * server-fn for admin/team views) where team actors see everything.
 * If you're wiring this into a non-team-authed surface (portal, public
 * REST, widget), wrap it with a `canViewPost` check first or refactor
 * to take an `Actor` parameter — otherwise team-only board metadata
 * leaks to portal viewers.
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
      eta: true,
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

  // Get board, tags, roadmaps, and pinned comment in parallel
  const [board, postTagsResult, roadmapsResult, pinnedCommentData] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, post.boardId) }),
    db
      .select({
        id: postTags.id,
        name: postTags.name,
        color: postTags.color,
      })
      .from(postTagAssignments)
      .innerJoin(postTags, eq(postTags.id, postTagAssignments.tagId))
      .where(eq(postTagAssignments.postId, postId)),
    db
      .select({ roadmapId: postRoadmaps.roadmapId })
      .from(postRoadmaps)
      .where(eq(postRoadmaps.postId, postId)),
    post.pinnedCommentId
      ? db.query.postComments.findFirst({
          where: eq(postComments.id, post.pinnedCommentId),
          with: {
            author: {
              columns: { displayName: true, avatarUrl: true, avatarKey: true },
            },
          },
        })
      : undefined,
  ])

  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${post.boardId} not found`)
  }

  let pinnedComment: PinnedComment | null = null
  if (pinnedCommentData && !pinnedCommentData.deletedAt) {
    let avatarUrl: string | null = null
    if (pinnedCommentData.author) {
      if (pinnedCommentData.author.avatarKey) {
        avatarUrl = getPublicUrlOrNull(pinnedCommentData.author.avatarKey)
      }
      if (!avatarUrl && pinnedCommentData.author.avatarUrl) {
        avatarUrl = pinnedCommentData.author.avatarUrl
      }
    }

    const pinnedRawContentJson = pinnedCommentData.contentJson ?? null
    const pinnedHydratedContentJson = pinnedRawContentJson
      ? ((await hydrateMentions(pinnedRawContentJson as JSONContent)) as TiptapContent | null)
      : null
    pinnedComment = {
      id: pinnedCommentData.id,
      content: pinnedCommentData.content,
      contentJson: pinnedHydratedContentJson,
      authorName: pinnedCommentData.author?.displayName ?? null,
      principalId: pinnedCommentData.principalId,
      avatarUrl,
      createdAt: pinnedCommentData.createdAt,
      isTeamMember: pinnedCommentData.isTeamMember,
    }
  }

  // Hydrate mention labels on the post body so renamed users render correctly.
  const hydratedPostContentJson = post.contentJson
    ? ((await hydrateMentions(post.contentJson as JSONContent)) as TiptapContent | null)
    : post.contentJson

  // Cast needed: columns selection omits heavy internal fields (embedding, searchVector,
  // etc.) that no caller reads, but PostWithDetails extends the full Post type.
  const postWithDetails = {
    ...post,
    contentJson: hydratedPostContentJson,
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
    // Sanitize at the source so every consumer (admin detail, v1 API, …) is safe.
    authorEmail: realEmail(post.author?.user?.email),
  } as unknown as PostWithDetails

  return postWithDetails
}

/**
 * Get comments with nested replies and reactions for a post.
 *
 * SECURITY: the post is fetched without a `canViewBoard` /
 * `canViewPost` check. Current callers (admin merge, team server fn,
 * MCP, team-authed REST) are all team-level, where the policy
 * short-circuits. If you wire this into a portal/public surface,
 * verify the actor can view the parent post first — otherwise
 * comments on team-only or pending posts leak.
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

  // Collect post IDs: this post + any posts merged into it. Exclude
  // sources whose own board has been soft-deleted — otherwise comments
  // from a deleted board's posts surface here via the merge tree.
  const mergedPosts = await db
    .select({ id: posts.id })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(
      and(eq(posts.canonicalPostId, postId), isNull(posts.deletedAt), isNull(boards.deletedAt))
    )
  const postIds = [postId, ...mergedPosts.map((p) => p.id)] as PostId[]

  // Get all comments with reactions, author info, and status changes (including from merged posts)
  const allComments = await db.query.postComments.findMany({
    where:
      postIds.length === 1
        ? eq(postComments.postId, postId)
        : inArray(postComments.postId, postIds),
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
    orderBy: asc(postComments.createdAt),
  })

  // Build nested tree using the utility function
  const commentsWithAuthor = allComments.map((c) => ({
    ...c,
    authorName: c.author?.displayName ?? null,
    statusChange: toStatusChange(c.statusChangeFrom, c.statusChangeTo),
  }))

  return buildCommentTree(commentsWithAuthor, principalId)
}
