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
  tags,
  comments,
  postEditHistory,
  type Post,
} from '@quackback/db'
import { toUuid, type PostId, type BoardId, type StatusId, type MemberId } from '@quackback/ids'
import { ok, err, type Result } from '@/lib/shared'
import { PostError } from './post.errors'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '@/lib/settings'
import { subscribeToPost } from '@/lib/subscriptions'
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
): Promise<Result<CreatePostResult, PostError>> {
  return db.transaction(async (tx) => {
    // Basic validation (also done at action layer, but enforced here for direct service calls)
    const title = input.title?.trim()
    const content = input.content?.trim()

    if (!title) {
      return err(PostError.validationError('Title is required'))
    }
    if (!content) {
      return err(PostError.validationError('Content is required'))
    }
    if (title.length > 200) {
      return err(PostError.validationError('Title must not exceed 200 characters'))
    }
    if (content.length > 10000) {
      return err(PostError.validationError('Content must not exceed 10,000 characters'))
    }

    // Validate board exists and belongs to this organization
    const board = await tx.query.boards.findFirst({ where: eq(boards.id, input.boardId) })
    if (!board) {
      return err(PostError.boardNotFound(input.boardId))
    }

    // Determine statusId - either from input or use default "open" status
    let statusId = input.statusId
    if (!statusId) {
      // Look up default "open" status
      const [defaultStatus] = await tx
        .select()
        .from(postStatuses)
        .where(eq(postStatuses.slug, 'open'))
        .limit(1)

      if (!defaultStatus) {
        return err(
          PostError.validationError(
            'Default "open" status not found. Please ensure post statuses are configured for this organization.'
          )
        )
      }

      statusId = defaultStatus.id
    }

    // Create the post with member-scoped identity
    // Convert member TypeID back to raw UUID for database foreign key
    const [post] = await tx
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
      // Remove all existing tags
      await tx.delete(postTags).where(eq(postTags.postId, post.id))
      // Add new tags
      await tx.insert(postTags).values(input.tagIds.map((tagId) => ({ postId: post.id, tagId })))
    }

    // Auto-subscribe the author to their own post (within the same transaction)
    await subscribeToPost(author.memberId, post.id, 'author', {
      db: tx,
    })

    // Return post with board info for event building in API route
    return ok({ ...post, boardSlug: board.slug })
  })
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
): Promise<Result<Post, PostError>> {
  return db.transaction(async (tx) => {
    // Get existing post
    const existingPost = await tx.query.posts.findFirst({ where: eq(posts.id, id) })
    if (!existingPost) {
      return err(PostError.notFound(id))
    }

    // Verify post belongs to this organization (via its board)
    const board = await tx.query.boards.findFirst({ where: eq(boards.id, existingPost.boardId) })
    if (!board) {
      return err(PostError.boardNotFound(existingPost.boardId))
    }

    // Validate input
    if (input.title !== undefined) {
      if (!input.title.trim()) {
        return err(PostError.validationError('Title cannot be empty'))
      }
      if (input.title.length > 200) {
        return err(PostError.validationError('Title must be 200 characters or less'))
      }
    }
    if (input.content !== undefined) {
      if (!input.content.trim()) {
        return err(PostError.validationError('Content cannot be empty'))
      }
      if (input.content.length > 10000) {
        return err(PostError.validationError('Content must be 10,000 characters or less'))
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
    const [updatedPost] = await tx.update(posts).set(updateData).where(eq(posts.id, id)).returning()
    if (!updatedPost) {
      return err(PostError.notFound(id))
    }

    // Update tags if provided
    if (input.tagIds !== undefined) {
      // Remove all existing tags
      await tx.delete(postTags).where(eq(postTags.postId, id))
      // Add new tags if any
      if (input.tagIds.length > 0) {
        await tx.insert(postTags).values(input.tagIds.map((tagId) => ({ postId: id, tagId })))
      }
    }

    return ok(updatedPost)
  })
}

/**
 * Toggle vote on a post
 *
 * If the user has already voted, removes the vote.
 * If the user hasn't voted, adds a vote.
 *
 * Uses atomic SQL to prevent race conditions and ensure vote count integrity.
 *
 * @param postId - Post ID to vote on
 * @param userIdentifier - Unique identifier for the voter (member:id or anon:uuid)
 * @param options - Optional audit data (memberId, ipHash)
 * @returns Result containing vote status and new count, or an error
 */
export async function voteOnPost(
  postId: PostId,
  userIdentifier: string,
  options?: { memberId?: MemberId; ipHash?: string }
): Promise<Result<VoteResult, PostError>> {
  return db.transaction(async (tx) => {
    // Verify post exists
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, postId) })
    if (!post) {
      return err(PostError.notFound(postId))
    }

    // Verify post belongs to this organization
    const board = await tx.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board) {
      return err(PostError.boardNotFound(post.boardId))
    }

    // Single atomic operation: check existing vote, then insert or delete + update count
    // Uses existing unique index on (post_id, user_identifier)
    // Convert TypeIDs to UUIDs for raw SQL query
    const postUuid = toUuid(postId)
    // Convert memberId TypeID to UUID for raw SQL
    const memberUuid = options?.memberId ? toUuid(options.memberId) : null
    const result = await tx.execute<{ vote_count: number; voted: boolean }>(sql`
      WITH existing_vote AS (
        SELECT id FROM votes
        WHERE post_id = ${postUuid} AND user_identifier = ${userIdentifier}
        FOR UPDATE
      ),
      vote_action AS (
        -- Delete if vote exists, insert if it doesn't
        DELETE FROM votes
        WHERE id = (SELECT id FROM existing_vote)
        RETURNING id, false AS is_new_vote
      ),
      insert_vote AS (
        -- Only insert if no existing vote was found (and thus not deleted)
        INSERT INTO votes (id, post_id, user_identifier, member_id, ip_hash, updated_at)
        SELECT gen_random_uuid(), ${postUuid}, ${userIdentifier}, ${memberUuid}, ${options?.ipHash ?? null}, NOW()
        WHERE NOT EXISTS (SELECT 1 FROM existing_vote)
        RETURNING id, true AS is_new_vote
      ),
      combined AS (
        SELECT is_new_vote FROM vote_action
        UNION ALL
        SELECT is_new_vote FROM insert_vote
      )
      UPDATE posts
      SET vote_count = GREATEST(0, vote_count + CASE
        WHEN (SELECT is_new_vote FROM combined LIMIT 1) THEN 1
        ELSE -1
      END)
      WHERE id = ${postUuid}
      RETURNING vote_count, (SELECT is_new_vote FROM combined LIMIT 1) AS voted
    `)

    const row = result[0]
    const voted = row?.voted ?? false

    // Auto-subscribe voter when they upvote (not when they remove vote)
    if (voted && options?.memberId) {
      await subscribeToPost(options.memberId, postId, 'vote', {
        db: tx,
      })
    }

    return ok({
      voted,
      voteCount: row?.vote_count ?? post.voteCount,
    })
  })
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
): Promise<Result<ChangeStatusResult, PostError>> {
  return db.transaction(async (tx) => {
    // Get existing post
    const existingPost = await tx.query.posts.findFirst({ where: eq(posts.id, postId) })
    if (!existingPost) {
      return err(PostError.notFound(postId))
    }

    // Verify post belongs to this organization
    const board = await tx.query.boards.findFirst({ where: eq(boards.id, existingPost.boardId) })
    if (!board) {
      return err(PostError.boardNotFound(existingPost.boardId))
    }

    // Validate status exists (query the postStatuses table)
    const newStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.id, statusId),
    })
    if (!newStatus) {
      return err(PostError.statusNotFound(statusId))
    }

    // Get previous status name for event
    let previousStatusName = 'Open'
    if (existingPost.statusId) {
      const prevStatus = await tx.query.postStatuses.findFirst({
        where: eq(postStatuses.id, existingPost.statusId),
      })
      if (prevStatus) {
        previousStatusName = prevStatus.name
      }
    }

    // Update the post status
    const [updatedPost] = await tx
      .update(posts)
      .set({ statusId })
      .where(eq(posts.id, postId))
      .returning()
    if (!updatedPost) {
      return err(PostError.notFound(postId))
    }

    // Return post with status change info for event building in API route
    return ok({
      ...updatedPost,
      boardSlug: board.slug,
      previousStatus: previousStatusName,
      newStatus: newStatus.name,
    })
  })
}

/**
 * Get a post by ID with details
 *
 * @param postId - Post ID to fetch
 * @returns Result containing the post with details or an error
 */
export async function getPostById(postId: PostId): Promise<Result<Post, PostError>> {
  return db.transaction(async (tx) => {
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, postId) })
    if (!post) {
      return err(PostError.notFound(postId))
    }

    // Verify post belongs to this organization
    const board = await tx.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board) {
      return err(PostError.boardNotFound(post.boardId))
    }

    return ok(post)
  })
}

/**
 * Get a post with full details including board, tags, and comment count
 *
 * @param postId - Post ID to fetch
 * @returns Result containing the post with details or an error
 */
export async function getPostWithDetails(
  postId: PostId
): Promise<Result<PostWithDetails, PostError>> {
  return db.transaction(async (tx) => {
    // Get the post
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, postId) })
    if (!post) {
      return err(PostError.notFound(postId))
    }

    // Get the board and verify it belongs to this organization
    const board = await tx.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board) {
      return err(PostError.boardNotFound(post.boardId))
    }

    // Get tags via postTags junction table
    const postTagsResult = await tx
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(eq(postTags.postId, postId))

    // Get comment count
    const [commentCountResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(comments)
      .where(eq(comments.postId, postId))

    const commentCount = commentCountResult?.count || 0

    const postWithDetails: PostWithDetails = {
      ...post,
      board: {
        id: board.id,
        name: board.name,
        slug: board.slug,
      },
      tags: postTagsResult,
      commentCount,
    }

    return ok(postWithDetails)
  })
}

/**
 * Get comments with nested replies and reactions for a post
 *
 * @param postId - Post ID to fetch comments for
 * @param userIdentifier - User identifier to check for reactions (e.g., "member:uuid" or "anon:uuid")
 * @returns Result containing nested comment tree or an error
 */
export async function getCommentsWithReplies(
  postId: PostId,
  userIdentifier: string
): Promise<Result<CommentTreeNode[], PostError>> {
  return db.transaction(async (tx) => {
    // Verify post exists and belongs to organization
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, postId) })
    if (!post) {
      return err(PostError.notFound(postId))
    }

    const board = await tx.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board) {
      return err(PostError.boardNotFound(post.boardId))
    }

    // Get all comments with reactions
    const allComments = await tx.query.comments.findMany({
      where: eq(comments.postId, postId),
      with: {
        reactions: true,
      },
      orderBy: asc(comments.createdAt),
    })

    // Build nested tree using the utility function from @quackback/db
    const commentTree = buildCommentTree(allComments, userIdentifier)

    return ok(commentTree)
  })
}

/**
 * List posts for admin inbox with advanced filtering
 *
 * @param params - Query parameters including filters, sort, and pagination
 * @returns Result containing inbox post list or an error
 */
export async function listInboxPosts(
  params: InboxPostListParams
): Promise<Result<InboxPostListResult, PostError>> {
  return db.transaction(async (tx) => {
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

    // Get board IDs - either use provided list or get all boards
    const allBoardIds = boardIds?.length
      ? boardIds
      : (
          await tx.query.boards.findMany({
            columns: { id: true },
          })
        ).map((b) => b.id)

    if (allBoardIds.length === 0) {
      return ok({ items: [], total: 0, hasMore: false })
    }

    conditions.push(inArray(posts.boardId, allBoardIds))

    // Status filter - resolve slugs to IDs using indexed lookup, or use IDs directly
    let resolvedStatusIds = statusIds
    if (statusSlugs && statusSlugs.length > 0) {
      const statusesBySlug = await tx.query.postStatuses.findMany({
        where: inArray(postStatuses.slug, statusSlugs),
        columns: { id: true },
      })
      resolvedStatusIds = (statusesBySlug ?? []).map((s) => s.id)
    }

    if (resolvedStatusIds && resolvedStatusIds.length > 0) {
      conditions.push(inArray(posts.statusId, resolvedStatusIds))
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

    // Tag filter - posts must have at least one of the selected tags
    let postIdsWithTags: PostId[] | null = null
    if (tagIds && tagIds.length > 0) {
      const postsWithSelectedTags = await tx
        .selectDistinct({ postId: postTags.postId })
        .from(postTags)
        .where(inArray(postTags.tagId, tagIds))

      postIdsWithTags = postsWithSelectedTags.map((p) => p.postId)

      if (postIdsWithTags.length === 0) {
        return ok({ items: [], total: 0, hasMore: false })
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
      tx.query.posts.findMany({
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
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(posts)
        .where(whereClause),
    ])

    // Get comment counts for all posts
    const postIds = rawPosts.map((p) => p.id)
    const commentCounts =
      postIds.length > 0
        ? await tx
            .select({
              postId: comments.postId,
              count: sql<number>`count(*)::int`.as('count'),
            })
            .from(comments)
            .where(inArray(comments.postId, postIds))
            .groupBy(comments.postId)
        : []

    const commentCountMap = new Map(commentCounts.map((c) => [c.postId, Number(c.count)]))

    // Transform to PostListItem format
    const items = rawPosts.map((post) => ({
      ...post,
      board: post.board,
      tags: post.tags.map((pt) => pt.tag),
      commentCount: commentCountMap.get(post.id) ?? 0,
    }))

    const total = Number(countResult[0].count)

    return ok({
      items,
      total,
      hasMore: page * limit < total,
    })
  })
}

/**
 * List posts for export (all posts with full details)
 *
 * @param boardId - Optional board ID to filter by
 * @returns Result containing posts for export or an error
 */
export async function listPostsForExport(
  boardId: BoardId | undefined
): Promise<Result<PostForExport[], PostError>> {
  return db.transaction(async (tx) => {
    // Build conditions
    const conditions = []

    // Get board IDs - either specific board or all boards
    const allBoardIds = boardId
      ? [boardId]
      : (
          await tx.query.boards.findMany({
            columns: { id: true },
          })
        ).map((b) => b.id)

    if (allBoardIds.length === 0) {
      return ok([])
    }

    conditions.push(inArray(posts.boardId, allBoardIds))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Get all posts with board and tags
    const rawPosts = await tx.query.posts.findMany({
      where: whereClause,
      orderBy: desc(posts.createdAt),
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

    // Get status details for posts that have a statusId
    const postStatusIds = rawPosts
      .filter((p) => p.statusId)
      .map((p) => p.statusId!)
      .filter((id, index, self) => self.indexOf(id) === index) // unique

    const statusDetails =
      postStatusIds.length > 0
        ? await tx.query.postStatuses.findMany({
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

    return ok(exportPosts)
  })
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
 * @returns Result containing permission check result
 */
export async function canEditPost(
  postId: PostId,
  actor: { memberId: MemberId; role: 'owner' | 'admin' | 'member' | 'user' },
  portalConfig?: PortalConfig
): Promise<Result<PermissionCheckResult, PostError>> {
  const { db } = await import('@quackback/db')

  // Get the post
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  })

  if (!post) {
    return err(PostError.notFound(postId))
  }

  // Check if post is deleted
  if (post.deletedAt) {
    return ok({ allowed: false, reason: 'Cannot edit a deleted post' })
  }

  // Team members (owner, admin, member) can always edit
  if (['owner', 'admin', 'member'].includes(actor.role)) {
    return ok({ allowed: true })
  }

  // Must be the author
  if (post.memberId !== actor.memberId) {
    return ok({ allowed: false, reason: 'You can only edit your own posts' })
  }

  // Get portal config if not provided
  const config = portalConfig ?? (await getPortalConfig())

  // Check if status is default (Open)
  const isDefault = await isDefaultStatus(post.statusId)
  if (!isDefault && !config.features.allowEditAfterEngagement) {
    return ok({ allowed: false, reason: 'Cannot edit posts that have been reviewed by the team' })
  }

  // Check for engagement (votes, comments from others)
  if (!config.features.allowEditAfterEngagement) {
    if (post.voteCount > 0) {
      return ok({ allowed: false, reason: 'Cannot edit posts that have received votes' })
    }

    const hasOtherComments = await hasCommentsFromOthers(postId, actor.memberId)
    if (hasOtherComments) {
      return ok({
        allowed: false,
        reason: 'Cannot edit posts that have comments from other users',
      })
    }
  }

  return ok({ allowed: true })
}

/**
 * Check if a user can delete a post
 *
 * @param postId - Post ID to check
 * @param actor - Actor information (memberId, role)
 * @param portalConfig - Optional portal config (will fetch if not provided)
 * @returns Result containing permission check result
 */
export async function canDeletePost(
  postId: PostId,
  actor: { memberId: MemberId; role: 'owner' | 'admin' | 'member' | 'user' },
  portalConfig?: PortalConfig
): Promise<Result<PermissionCheckResult, PostError>> {
  const { db } = await import('@quackback/db')

  // Get the post
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  })

  if (!post) {
    return err(PostError.notFound(postId))
  }

  // Check if post is already deleted
  if (post.deletedAt) {
    return ok({ allowed: false, reason: 'Post has already been deleted' })
  }

  // Team members (owner, admin, member) can always delete
  if (['owner', 'admin', 'member'].includes(actor.role)) {
    return ok({ allowed: true })
  }

  // Must be the author
  if (post.memberId !== actor.memberId) {
    return ok({ allowed: false, reason: 'You can only delete your own posts' })
  }

  // Get portal config if not provided
  const config = portalConfig ?? (await getPortalConfig())

  // Check if status is default (Open)
  const isDefault = await isDefaultStatus(post.statusId)
  if (!isDefault && !config.features.allowDeleteAfterEngagement) {
    return ok({
      allowed: false,
      reason: 'Cannot delete posts that have been reviewed by the team',
    })
  }

  // Check for engagement (votes, comments)
  if (!config.features.allowDeleteAfterEngagement) {
    if (post.voteCount > 0) {
      return ok({ allowed: false, reason: 'Cannot delete posts that have received votes' })
    }

    // Check for any comments (not just from others)
    const commentCount = await getCommentCount(postId)
    if (commentCount > 0) {
      return ok({ allowed: false, reason: 'Cannot delete posts that have comments' })
    }
  }

  return ok({ allowed: true })
}

/**
 * User edits their own post
 * Validates permissions and records edit history if enabled
 *
 * @param postId - Post ID to edit
 * @param input - Edit data (title, content, contentJson)
 * @param actor - Actor information (memberId, role)
 * @returns Result containing updated post or error
 */
export async function userEditPost(
  postId: PostId,
  input: UserEditPostInput,
  actor: { memberId: MemberId; role: 'owner' | 'admin' | 'member' | 'user' }
): Promise<Result<Post, PostError>> {
  // Check permission first
  const permResult = await canEditPost(postId, actor)
  if (!permResult.success) {
    return err(permResult.error)
  }
  if (!permResult.value.allowed) {
    return err(PostError.editNotAllowed(permResult.value.reason || 'Edit not allowed'))
  }

  return db.transaction(async (tx) => {
    // Get the existing post
    const existingPost = await tx.query.posts.findFirst({ where: eq(posts.id, postId) })
    if (!existingPost) {
      return err(PostError.notFound(postId))
    }

    // Validate input
    if (!input.title?.trim()) {
      return err(PostError.validationError('Title is required'))
    }
    if (!input.content?.trim()) {
      return err(PostError.validationError('Content is required'))
    }
    if (input.title.length > 200) {
      return err(PostError.validationError('Title must be 200 characters or less'))
    }
    if (input.content.length > 10000) {
      return err(PostError.validationError('Content must be 10,000 characters or less'))
    }

    // Get portal config to check if edit history is enabled
    const config = await getPortalConfig()

    // Record edit history if enabled
    if (config.features.showPublicEditHistory) {
      await tx.insert(postEditHistory).values({
        postId: postId,
        editorMemberId: actor.memberId,
        previousTitle: existingPost.title,
        previousContent: existingPost.content,
        previousContentJson: existingPost.contentJson,
      })
    }

    // Update the post
    const [updatedPost] = await tx
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
      return err(PostError.notFound(postId))
    }

    return ok(updatedPost)
  })
}

/**
 * Soft delete a post
 * Sets deletedAt timestamp, hiding from public views
 *
 * @param postId - Post ID to delete
 * @param actor - Actor information (memberId, role)
 * @returns Result indicating success or error
 */
export async function softDeletePost(
  postId: PostId,
  actor: { memberId: MemberId; role: 'owner' | 'admin' | 'member' | 'user' }
): Promise<Result<void, PostError>> {
  // Check permission first
  const permResult = await canDeletePost(postId, actor)
  if (!permResult.success) {
    return err(permResult.error)
  }
  if (!permResult.value.allowed) {
    return err(PostError.deleteNotAllowed(permResult.value.reason || 'Delete not allowed'))
  }

  return db.transaction(async (tx) => {
    // Set deletedAt and deletedByMemberId
    const [updatedPost] = await tx
      .update(posts)
      .set({
        deletedAt: new Date(),
        deletedByMemberId: actor.memberId,
      })
      .where(eq(posts.id, postId))
      .returning()

    if (!updatedPost) {
      return err(PostError.notFound(postId))
    }

    return ok(undefined)
  })
}

/**
 * Restore a soft-deleted post (admin only)
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param postId - Post ID to restore
 * @returns Result containing restored post or error
 */
export async function restorePost(postId: PostId): Promise<Result<Post, PostError>> {
  return db.transaction(async (tx) => {
    // Get the post
    const existingPost = await tx.query.posts.findFirst({ where: eq(posts.id, postId) })
    if (!existingPost) {
      return err(PostError.notFound(postId))
    }

    if (!existingPost.deletedAt) {
      return err(PostError.validationError('Post is not deleted'))
    }

    // Clear deletedAt and deletedByMemberId
    const [restoredPost] = await tx
      .update(posts)
      .set({
        deletedAt: null,
        deletedByMemberId: null,
      })
      .where(eq(posts.id, postId))
      .returning()

    if (!restoredPost) {
      return err(PostError.notFound(postId))
    }

    return ok(restoredPost)
  })
}

/**
 * Permanently delete a post (admin only)
 * This is a hard delete and cannot be undone
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param postId - Post ID to permanently delete
 * @returns Result indicating success or error
 */
export async function permanentDeletePost(postId: PostId): Promise<Result<void, PostError>> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx.delete(posts).where(eq(posts.id, postId)).returning()
    if (!deleted) {
      return err(PostError.notFound(postId))
    }

    return ok(undefined)
  })
}

// ============================================================================
// Helper Methods (unexported)
// ============================================================================

/**
 * Check if a status is the default "open" status
 */
async function isDefaultStatus(statusId: StatusId | null): Promise<boolean> {
  if (!statusId) return true // No status = treat as default

  const { db } = await import('@quackback/db')

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

  const { db } = await import('@quackback/db')

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
  const { db } = await import('@quackback/db')

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(comments)
    .where(and(eq(comments.postId, postId), isNull(comments.deletedAt)))

  return result[0]?.count ?? 0
}

/**
 * Get portal config (single-tenant mode - returns global config)
 */
async function getPortalConfig(): Promise<PortalConfig> {
  const { db } = await import('@quackback/db')

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
