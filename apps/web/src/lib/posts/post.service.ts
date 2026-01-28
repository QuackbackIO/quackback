/**
 * PostService - Business logic for post operations
 *
 * This service handles all post-related business logic including:
 * - Post creation and updates
 * - Voting operations
 * - Status changes
 * - Validation and authorization
 */

import {
  db,
  boards,
  eq,
  and,
  inArray,
  desc,
  asc,
  sql,
  isNull,
  postStatuses,
  posts,
  postTags,
  postRoadmaps,
  tags,
  comments,
  postEditHistory,
  votes,
  type Post,
} from '@/lib/db'
import { toUuid, type PostId, type BoardId, type StatusId, type MemberId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '@/lib/settings'
import { subscribeToPost } from '@/lib/subscriptions/subscription.service'
import { buildCommentTree, type CommentTreeNode } from '@/lib/shared'
import type {
  CreatePostInput,
  UpdatePostInput,
  VoteResult,
  PostWithDetails,
  InboxPostListParams,
  InboxPostListResult,
  PostForExport,
  PermissionCheckResult,
  UserEditPostInput,
  CreatePostResult,
  ChangeStatusResult,
  PinnedComment,
} from './post.types'

/**
 * Create a new post
 *
 * Validates that:
 * - Board exists and belongs to the organization
 * - User has permission to create posts
 * - Input data is valid
 *
 * @param input - Post creation data
 * @param author - Author information (memberId, name, email)
 * @returns Result containing the created post or an error
 */
export async function createPost(
  input: CreatePostInput,
  author: { memberId: MemberId; name: string; email: string }
): Promise<CreatePostResult> {
  // Basic validation (also done at action layer, but enforced here for direct service calls)
  const title = input.title?.trim()
  const content = input.content?.trim()

  if (!title) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  if (!content) {
    throw new ValidationError('VALIDATION_ERROR', 'Content is required')
  }
  if (title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must not exceed 200 characters')
  }
  if (content.length > 10000) {
    throw new ValidationError('VALIDATION_ERROR', 'Content must not exceed 10,000 characters')
  }

  // Validate board exists and belongs to this organization
  const board = await db.query.boards.findFirst({ where: eq(boards.id, input.boardId) })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${input.boardId} not found`)
  }

  // Determine statusId - either from input or use default "open" status
  let statusId = input.statusId
  if (!statusId) {
    // Look up default "open" status
    const [defaultStatus] = await db
      .select()
      .from(postStatuses)
      .where(eq(postStatuses.slug, 'open'))
      .limit(1)

    if (!defaultStatus) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'Default "open" status not found. Please ensure post statuses are configured for this organization.'
      )
    }

    statusId = defaultStatus.id
  }

  // Create the post with member-scoped identity
  // Convert member TypeID back to raw UUID for database foreign key
  const [post] = await db
    .insert(posts)
    .values({
      boardId: input.boardId,
      title,
      content,
      contentJson: input.contentJson,
      statusId,
      memberId: author.memberId,
      authorName: author.name,
      authorEmail: author.email,
    })
    .returning()

  // Add tags if provided
  if (input.tagIds && input.tagIds.length > 0) {
    // Remove all existing tags then add new ones
    await db.delete(postTags).where(eq(postTags.postId, post.id))
    await db.insert(postTags).values(input.tagIds.map((tagId) => ({ postId: post.id, tagId })))
  }

  // Auto-subscribe the author to their own post
  await subscribeToPost(author.memberId, post.id, 'author')

  // Return post with board info for event building in API route
  return { ...post, boardSlug: board.slug }
}

/**
 * Update an existing post
 *
 * Validates that:
 * - Post exists and belongs to the organization
 * - Update data is valid
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param id - Post ID to update
 * @param input - Update data
 * @param responder - Optional responder info for official response (memberId, name)
 * @returns Result containing the updated post or an error
 */
export async function updatePost(
  id: PostId,
  input: UpdatePostInput,
  responder?: { memberId: MemberId; name: string }
): Promise<Post> {
  // Get existing post
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, id) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${id} not found`)
  }

  // Verify post belongs to this organization (via its board)
  const board = await db.query.boards.findFirst({ where: eq(boards.id, existingPost.boardId) })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${existingPost.boardId} not found`)
  }

  // Validate input
  if (input.title !== undefined) {
    if (!input.title.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Title cannot be empty')
    }
    if (input.title.length > 200) {
      throw new ValidationError('VALIDATION_ERROR', 'Title must be 200 characters or less')
    }
  }
  if (input.content !== undefined) {
    if (!input.content.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Content cannot be empty')
    }
    if (input.content.length > 10000) {
      throw new ValidationError('VALIDATION_ERROR', 'Content must be 10,000 characters or less')
    }
  }

  // Build update data
  const updateData: Partial<Post> = {}
  if (input.title !== undefined) updateData.title = input.title.trim()
  if (input.content !== undefined) updateData.content = input.content.trim()
  if (input.contentJson !== undefined) updateData.contentJson = input.contentJson
  if (input.statusId !== undefined) updateData.statusId = input.statusId
  if (input.ownerId !== undefined) updateData.ownerId = input.ownerId
  if (input.ownerMemberId !== undefined) updateData.ownerMemberId = input.ownerMemberId

  // Handle official response update
  if (input.officialResponse !== undefined) {
    if (input.officialResponse === null || input.officialResponse === '') {
      // Clear the official response
      updateData.officialResponse = null
      updateData.officialResponseMemberId = null
      updateData.officialResponseAuthorName = null
      updateData.officialResponseAt = null
    } else {
      // Set or update official response with member-scoped identity
      const responseMemberId = input.officialResponseMemberId || responder?.memberId
      updateData.officialResponse = input.officialResponse
      updateData.officialResponseMemberId = responseMemberId
      updateData.officialResponseAuthorName = input.officialResponseAuthorName || responder?.name
      updateData.officialResponseAt = new Date()
    }
  }

  // Update the post
  const [updatedPost] = await db.update(posts).set(updateData).where(eq(posts.id, id)).returning()
  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${id} not found`)
  }

  // Update tags if provided
  if (input.tagIds !== undefined) {
    // Remove all existing tags then add new ones if any
    await db.delete(postTags).where(eq(postTags.postId, id))
    if (input.tagIds.length > 0) {
      await db.insert(postTags).values(input.tagIds.map((tagId) => ({ postId: id, tagId })))
    }
  }

  return updatedPost
}

/**
 * Toggle vote on a post
 *
 * If the user has already voted, removes the vote.
 * If the user hasn't voted, adds a vote.
 *
 * Uses atomic SQL to prevent race conditions and ensure vote count integrity.
 * Only authenticated users can vote (member_id is required).
 *
 * @param postId - Post ID to vote on
 * @param memberId - Member ID of the voter (required)
 * @returns Result containing vote status and new count, or an error
 */
export async function voteOnPost(postId: PostId, memberId: MemberId): Promise<VoteResult> {
  // Verify post exists
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Verify post belongs to this organization
  const board = await db.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${post.boardId} not found`)
  }

  // Toggle vote using single atomic CTE query (Neon HTTP driver doesn't support transactions)
  const postUuid = toUuid(postId)
  const memberUuid = toUuid(memberId)

  // Atomic toggle: delete if exists, insert if not, update count accordingly
  await db.execute(sql`
    WITH existing AS (
      SELECT id FROM votes
      WHERE post_id = ${postUuid} AND member_id = ${memberUuid}
    ),
    deleted AS (
      DELETE FROM votes
      WHERE id IN (SELECT id FROM existing)
      RETURNING id
    ),
    inserted AS (
      INSERT INTO votes (id, post_id, member_id, updated_at)
      SELECT gen_random_uuid(), ${postUuid}, ${memberUuid}, NOW()
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      ON CONFLICT (post_id, member_id) DO NOTHING
      RETURNING id
    )
    UPDATE posts
    SET vote_count = GREATEST(0, vote_count +
      CASE
        WHEN EXISTS (SELECT 1 FROM inserted) THEN 1
        WHEN EXISTS (SELECT 1 FROM deleted) THEN -1
        ELSE 0
      END
    )
    WHERE id = ${postUuid}
  `)

  // Query final state (safe - previous query already committed)
  const [voteState] = await db
    .select({ voteCount: posts.voteCount })
    .from(posts)
    .where(eq(posts.id, postId))

  const [existingVote] = await db
    .select({ id: votes.id })
    .from(votes)
    .where(and(eq(votes.postId, postId), eq(votes.memberId, memberId)))

  const voted = existingVote !== undefined
  const voteCount = voteState?.voteCount ?? post.voteCount

  // Auto-subscribe voter when they upvote
  if (voted) {
    await subscribeToPost(memberId, postId, 'vote')
  }

  return { voted, voteCount }
}

/**
 * Change the status of a post
 *
 * Validates that:
 * - Post exists and belongs to the organization
 * - New status is valid
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param postId - Post ID to update
 * @param statusId - New status ID
 * @returns Result containing the updated post or an error
 */
export async function changeStatus(
  postId: PostId,
  statusId: StatusId
): Promise<ChangeStatusResult> {
  // Get existing post
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Verify post belongs to this organization and get status info in parallel
  const [board, newStatus, prevStatus] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, existingPost.boardId) }),
    db.query.postStatuses.findFirst({ where: eq(postStatuses.id, statusId) }),
    existingPost.statusId
      ? db.query.postStatuses.findFirst({ where: eq(postStatuses.id, existingPost.statusId) })
      : Promise.resolve(null),
  ])

  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${existingPost.boardId} not found`)
  }

  if (!newStatus) {
    throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${statusId} not found`)
  }

  const previousStatusName = prevStatus?.name ?? 'Open'

  // Update the post status
  const [updatedPost] = await db
    .update(posts)
    .set({ statusId })
    .where(eq(posts.id, postId))
    .returning()
  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Return post with status change info for event building in API route
  return {
    ...updatedPost,
    boardSlug: board.slug,
    previousStatus: previousStatusName,
    newStatus: newStatus.name,
  }
}

/**
 * Get a post by ID with details
 *
 * @param postId - Post ID to fetch
 * @returns Result containing the post with details or an error
 */
export async function getPostById(postId: PostId): Promise<Post> {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Verify post belongs to this organization
  const board = await db.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${post.boardId} not found`)
  }

  return post
}

/**
 * Get a post with full details including board, tags, and comment count
 * Uses Drizzle query builder with parallel queries for compatibility across drivers.
 *
 * @param postId - Post ID to fetch
 * @returns Result containing the post with details or an error
 */
export async function getPostWithDetails(postId: PostId): Promise<PostWithDetails> {
  // Get the post first
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
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
              columns: { image: true, imageBlob: true, imageType: true },
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
        if (user.imageBlob && user.imageType) {
          const base64 = Buffer.from(user.imageBlob).toString('base64')
          avatarUrl = `data:${user.imageType};base64,${base64}`
        } else if (user.image) {
          avatarUrl = user.image
        }
      }

      pinnedComment = {
        id: pinnedCommentData.id,
        content: pinnedCommentData.content,
        authorName: pinnedCommentData.authorName,
        memberId: pinnedCommentData.memberId,
        avatarUrl,
        createdAt: pinnedCommentData.createdAt,
        isTeamMember: pinnedCommentData.isTeamMember,
      }
    }
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

  // Get all comments with reactions
  const allComments = await db.query.comments.findMany({
    where: eq(comments.postId, postId),
    with: {
      reactions: true,
    },
    orderBy: asc(comments.createdAt),
  })

  // Build nested tree using the utility function
  const commentTree = buildCommentTree(allComments, memberId)

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
    conditions.push(sql`${posts.ownerId} IS NULL`)
  } else if (ownerId) {
    conditions.push(eq(posts.ownerId, ownerId))
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
    authorName: post.authorName,
    authorEmail: post.authorEmail,
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

// ============================================================================
// User Edit/Delete Methods
// ============================================================================

/**
 * Check if a user can edit a post
 *
 * @param postId - Post ID to check
 * @param actor - Actor information (memberId, role)
 * @param portalConfig - Optional portal config (will fetch if not provided)
 * @returns Permission check result
 */
export async function canEditPost(
  postId: PostId,
  actor: { memberId: MemberId; role: 'admin' | 'member' | 'user' },
  portalConfig?: PortalConfig
): Promise<PermissionCheckResult> {
  const { db } = await import('@/lib/db')

  // Get the post
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  })

  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Check if post is deleted
  if (post.deletedAt) {
    return { allowed: false, reason: 'Cannot edit a deleted post' }
  }

  // Team members (admin, member) can always edit
  if (['admin', 'member'].includes(actor.role)) {
    return { allowed: true }
  }

  // Must be the author
  if (post.memberId !== actor.memberId) {
    return { allowed: false, reason: 'You can only edit your own posts' }
  }

  // Get portal config if not provided
  const config = portalConfig ?? (await getPortalConfig())

  // Check if status is default (Open)
  const isDefault = await isDefaultStatus(post.statusId)
  if (!isDefault && !config.features.allowEditAfterEngagement) {
    return { allowed: false, reason: 'Cannot edit posts that have been reviewed by the team' }
  }

  // Check for engagement (votes, comments from others)
  if (!config.features.allowEditAfterEngagement) {
    if (post.voteCount > 0) {
      return { allowed: false, reason: 'Cannot edit posts that have received votes' }
    }

    const hasOtherComments = await hasCommentsFromOthers(postId, actor.memberId)
    if (hasOtherComments) {
      return {
        allowed: false,
        reason: 'Cannot edit posts that have comments from other users',
      }
    }
  }

  return { allowed: true }
}

/**
 * Check if a user can delete a post
 *
 * @param postId - Post ID to check
 * @param actor - Actor information (memberId, role)
 * @param portalConfig - Optional portal config (will fetch if not provided)
 * @returns Permission check result
 */
export async function canDeletePost(
  postId: PostId,
  actor: { memberId: MemberId; role: 'admin' | 'member' | 'user' },
  portalConfig?: PortalConfig
): Promise<PermissionCheckResult> {
  const { db } = await import('@/lib/db')

  // Get the post
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  })

  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Check if post is already deleted
  if (post.deletedAt) {
    return { allowed: false, reason: 'Post has already been deleted' }
  }

  // Team members (admin, member) can always delete
  if (['admin', 'member'].includes(actor.role)) {
    return { allowed: true }
  }

  // Must be the author
  if (post.memberId !== actor.memberId) {
    return { allowed: false, reason: 'You can only delete your own posts' }
  }

  // Get portal config if not provided
  const config = portalConfig ?? (await getPortalConfig())

  // Check if status is default (Open)
  const isDefault = await isDefaultStatus(post.statusId)
  if (!isDefault && !config.features.allowDeleteAfterEngagement) {
    return {
      allowed: false,
      reason: 'Cannot delete posts that have been reviewed by the team',
    }
  }

  // Check for engagement (votes, comments)
  if (!config.features.allowDeleteAfterEngagement) {
    if (post.voteCount > 0) {
      return { allowed: false, reason: 'Cannot delete posts that have received votes' }
    }

    // Check for any comments (not just from others)
    const commentCount = await getCommentCount(postId)
    if (commentCount > 0) {
      return { allowed: false, reason: 'Cannot delete posts that have comments' }
    }
  }

  return { allowed: true }
}

/**
 * User edits their own post
 * Validates permissions and records edit history if enabled
 *
 * @param postId - Post ID to edit
 * @param input - Edit data (title, content, contentJson)
 * @param actor - Actor information (memberId, role)
 * @returns Updated post
 */
export async function userEditPost(
  postId: PostId,
  input: UserEditPostInput,
  actor: { memberId: MemberId; role: 'admin' | 'member' | 'user' }
): Promise<Post> {
  // Check permission first (throws NotFoundError if post doesn't exist)
  const permResult = await canEditPost(postId, actor)
  if (!permResult.allowed) {
    throw new ForbiddenError('EDIT_NOT_ALLOWED', permResult.reason || 'Edit not allowed')
  }

  // Get the existing post
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Validate input
  if (!input.title?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  if (!input.content?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Content is required')
  }
  if (input.title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must be 200 characters or less')
  }
  if (input.content.length > 10000) {
    throw new ValidationError('VALIDATION_ERROR', 'Content must be 10,000 characters or less')
  }

  // Get portal config to check if edit history is enabled
  const config = await getPortalConfig()

  // Record edit history if enabled
  if (config.features.showPublicEditHistory) {
    await db.insert(postEditHistory).values({
      postId: postId,
      editorMemberId: actor.memberId,
      previousTitle: existingPost.title,
      previousContent: existingPost.content,
      previousContentJson: existingPost.contentJson,
    })
  }

  // Update the post
  const [updatedPost] = await db
    .update(posts)
    .set({
      title: input.title.trim(),
      content: input.content.trim(),
      contentJson: input.contentJson,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId))
    .returning()

  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  return updatedPost
}

/**
 * Soft delete a post
 * Sets deletedAt timestamp, hiding from public views
 *
 * @param postId - Post ID to delete
 * @param actor - Actor information (memberId, role)
 */
export async function softDeletePost(
  postId: PostId,
  actor: { memberId: MemberId; role: 'admin' | 'member' | 'user' }
): Promise<void> {
  // Check permission first (throws NotFoundError if post doesn't exist)
  const permResult = await canDeletePost(postId, actor)
  if (!permResult.allowed) {
    throw new ForbiddenError('DELETE_NOT_ALLOWED', permResult.reason || 'Delete not allowed')
  }

  // Set deletedAt and deletedByMemberId
  const [updatedPost] = await db
    .update(posts)
    .set({
      deletedAt: new Date(),
      deletedByMemberId: actor.memberId,
    })
    .where(eq(posts.id, postId))
    .returning()

  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }
}

/**
 * Restore a soft-deleted post (admin only)
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param postId - Post ID to restore
 * @returns Restored post
 */
export async function restorePost(postId: PostId): Promise<Post> {
  // Get the post first to validate it exists and is deleted
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (!existingPost.deletedAt) {
    throw new ValidationError('VALIDATION_ERROR', 'Post is not deleted')
  }

  // Clear deletedAt and deletedByMemberId
  const [restoredPost] = await db
    .update(posts)
    .set({
      deletedAt: null,
      deletedByMemberId: null,
    })
    .where(eq(posts.id, postId))
    .returning()

  if (!restoredPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  return restoredPost
}

/**
 * Permanently delete a post (admin only)
 * This is a hard delete and cannot be undone
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param postId - Post ID to permanently delete
 */
export async function permanentDeletePost(postId: PostId): Promise<void> {
  const [deleted] = await db.delete(posts).where(eq(posts.id, postId)).returning()
  if (!deleted) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }
}

// ============================================================================
// Helper Methods (unexported)
// ============================================================================

/**
 * Check if a status is the default "open" status
 */
async function isDefaultStatus(statusId: StatusId | null): Promise<boolean> {
  if (!statusId) return true // No status = treat as default

  const { db } = await import('@/lib/db')

  const status = await db.query.postStatuses.findFirst({
    where: and(eq(postStatuses.id, statusId), eq(postStatuses.isDefault, true)),
  })

  return !!status
}

/**
 * Check if a post has comments from users other than the author
 */
async function hasCommentsFromOthers(
  postId: PostId,
  authorMemberId: MemberId | null | undefined
): Promise<boolean> {
  if (!authorMemberId) return false // Anonymous author can't have "other" comments

  const { db } = await import('@/lib/db')

  // Find any comment not from the author and not deleted
  const otherComment = await db.query.comments.findFirst({
    where: and(
      eq(comments.postId, postId),
      sql`${comments.memberId} != ${authorMemberId}`,
      isNull(comments.deletedAt)
    ),
  })

  return !!otherComment
}

/**
 * Get the count of comments on a post (excluding deleted)
 */
async function getCommentCount(postId: PostId): Promise<number> {
  const { db } = await import('@/lib/db')

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(comments)
    .where(and(eq(comments.postId, postId), isNull(comments.deletedAt)))

  return result[0]?.count ?? 0
}

/**
 * Get portal config (single workspace mode - returns global config)
 */
async function getPortalConfig(): Promise<PortalConfig> {
  const { db } = await import('@/lib/db')

  // Get the global settings config
  const org = await db.query.settings.findFirst()

  if (!org?.portalConfig) {
    return DEFAULT_PORTAL_CONFIG
  }

  // Parse the JSON string from database
  let config: Partial<PortalConfig>
  try {
    config = JSON.parse(org.portalConfig) as Partial<PortalConfig>
  } catch {
    return DEFAULT_PORTAL_CONFIG
  }

  // Merge with defaults to ensure all fields exist
  return {
    ...DEFAULT_PORTAL_CONFIG,
    ...config,
    features: {
      ...DEFAULT_PORTAL_CONFIG.features,
      ...(config?.features ?? {}),
    },
  }
}
