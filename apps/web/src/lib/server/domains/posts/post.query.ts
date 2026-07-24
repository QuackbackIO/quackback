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
  postTags,
  postComments,
  eq,
  and,
  or,
  lt,
  inArray,
  asc,
  desc,
  isNull,
  count,
} from '@/lib/server/db'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { realEmail } from '@/lib/shared/anonymous-email'
import { type PostId, type PostCommentId, type PrincipalId } from '@quackback/ids'
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

  // Get board, tags, and pinned comment in parallel.
  const [board, postTagsResult, pinnedCommentData] = await Promise.all([
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
  const postIds = await resolveCommentPostIds(postId)

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

/**
 * Resolve the set of post ids whose comments belong to this post's thread:
 * the post itself plus any posts merged into it (excluding sources on a
 * soft-deleted board). Shared by the unbounded and paginated comment reads.
 */
async function resolveCommentPostIds(postId: PostId): Promise<PostId[]> {
  // Verify post exists and belongs to organization
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  const board = await db.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${post.boardId} not found`)
  }

  const mergedPosts = await db
    .select({ id: posts.id })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(
      and(eq(posts.canonicalPostId, postId), isNull(posts.deletedAt), isNull(boards.deletedAt))
    )
  return [postId, ...mergedPosts.map((p) => p.id)] as PostId[]
}

/**
 * Paginated variant of {@link getCommentsWithReplies} for the admin post
 * detail. Keyset-paginates by ROOT comment on `(created_at, id)` ascending so
 * a heavily-commented post no longer ships every rich-text doc in one payload.
 * Each returned root carries its full reply subtree.
 *
 * The unbounded `getCommentsWithReplies` is kept for the REST/MCP contract
 * (which promises the full list) and the merge path — this is opt-in.
 */
export async function getPaginatedCommentsWithReplies(
  postId: PostId,
  opts: { principalId?: PrincipalId; limit?: number; cursor?: string | null } = {}
): Promise<{
  comments: CommentTreeNode[]
  hasMore: boolean
  nextCursor: string | null
  totalRootCount: number
}> {
  const { encodeCommentCursor, decodeCommentCursor, DEFAULT_COMMENT_PAGE_SIZE } =
    await import('./comment-page')
  const rootLimit = Math.max(1, opts.limit ?? DEFAULT_COMMENT_PAGE_SIZE)
  const cursor = decodeCommentCursor(opts.cursor)

  const postIds = await resolveCommentPostIds(postId)
  const postFilter =
    postIds.length === 1 ? eq(postComments.postId, postId) : inArray(postComments.postId, postIds)

  // Page of root comments (parent_id IS NULL), keyset on (created_at, id)
  // DESCENDING so page 1 is the newest roots (matching the newest-first UI);
  // "show more" walks toward older roots via the strict `<` compare.
  const rootConditions = [postFilter, isNull(postComments.parentId)]
  if (cursor) {
    rootConditions.push(
      or(
        lt(postComments.createdAt, new Date(cursor.createdAt)),
        and(
          eq(postComments.createdAt, new Date(cursor.createdAt)),
          lt(postComments.id, cursor.id as PostCommentId)
        )
      )!
    )
  }
  const rootRows = await db.query.postComments.findMany({
    where: and(...rootConditions),
    columns: { id: true, createdAt: true },
    orderBy: [desc(postComments.createdAt), desc(postComments.id)],
    limit: rootLimit + 1,
  })
  const hasMore = rootRows.length > rootLimit
  const pageRoots = hasMore ? rootRows.slice(0, rootLimit) : rootRows
  const rootIds = pageRoots.map((r) => r.id)

  const [totalRootRow] = await db
    .select({ count: count() })
    .from(postComments)
    .where(and(postFilter, isNull(postComments.parentId)))
  const totalRootCount = Number(totalRootRow?.count ?? 0)

  const nextCursor =
    hasMore && pageRoots.length > 0
      ? encodeCommentCursor(
          pageRoots[pageRoots.length - 1].createdAt,
          pageRoots[pageRoots.length - 1].id
        )
      : null

  if (rootIds.length === 0) {
    return { comments: [], hasMore, nextCursor, totalRootCount }
  }

  // Fetch the roots + all their descendants (arbitrary depth) via a recursive
  // walk, then hydrate reactions/author/status and build the tree.
  const descendantIds = await collectDescendantIds(rootIds as PostCommentId[])
  const allIds = [...rootIds, ...descendantIds] as PostCommentId[]

  const allComments = await db.query.postComments.findMany({
    where: inArray(postComments.id, allIds),
    with: {
      reactions: true,
      author: { columns: { displayName: true } },
      statusChangeFrom: { columns: { name: true, color: true } },
      statusChangeTo: { columns: { name: true, color: true } },
    },
    orderBy: asc(postComments.createdAt),
  })

  const commentsWithAuthor = allComments.map((c) => ({
    ...c,
    authorName: c.author?.displayName ?? null,
    statusChange: toStatusChange(c.statusChangeFrom, c.statusChangeTo),
  }))

  return {
    comments: buildCommentTree(commentsWithAuthor, opts.principalId),
    hasMore,
    nextCursor,
    totalRootCount,
  }
}

/** Breadth-first collect all descendant comment ids under the given roots. */
async function collectDescendantIds(rootIds: PostCommentId[]): Promise<PostCommentId[]> {
  const collected: PostCommentId[] = []
  let frontier = rootIds
  // Reply chains are shallow in practice; this loop terminates quickly.
  while (frontier.length > 0) {
    const children = await db.query.postComments.findMany({
      where: inArray(postComments.parentId, frontier),
      columns: { id: true },
    })
    const childIds = children.map((c) => c.id)
    if (childIds.length === 0) break
    collected.push(...childIds)
    frontier = childIds
  }
  return collected
}
