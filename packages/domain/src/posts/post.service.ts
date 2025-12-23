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
  withUnitOfWork,
  PostRepository,
  BoardRepository,
  eq,
  and,
  inArray,
  desc,
  asc,
  sql,
  isNull,
  votes,
  postStatuses,
  posts,
  boards,
  postTags,
  tags,
  comments,
  postEditHistory,
  type Post,
  type UnitOfWork,
} from '@quackback/db'
import {
  toUuid,
  type PostId,
  type BoardId,
  type StatusId,
  type TagId,
  type MemberId,
  type CommentId,
} from '@quackback/ids'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { PostError } from './post.errors'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '../settings/settings.types'
import { SubscriptionService } from '../subscriptions'
import { buildCommentTree, type CommentTreeNode } from '../shared/comment-tree'
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
  PostEditHistoryEntry,
  CreatePostResult,
  ChangeStatusResult,
} from './post.types'

/**
 * Service class for post domain operations
 */
export class PostService {
  /**
   * Create a new post
   *
   * Validates that:
   * - Board exists and belongs to the organization
   * - User has permission to create posts
   * - Input data is valid
   *
   * @param input - Post creation data
   * @param ctx - Service context with user/org information
   * @returns Result containing the created post or an error
   */
  async createPost(
    input: CreatePostInput,
    ctx: ServiceContext
  ): Promise<Result<CreatePostResult, PostError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)
      const postRepo = new PostRepository(uow.db)

      // Validate board exists and belongs to this organization
      const board = await boardRepo.findById(input.boardId)
      if (!board) {
        return err(PostError.boardNotFound(input.boardId))
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

      // Determine statusId - either from input or use default "open" status
      let statusId = input.statusId
      if (!statusId) {
        // Look up default "open" status
        const [defaultStatus] = await uow.db
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
      const post = await postRepo.create({
        boardId: input.boardId,
        title: input.title.trim(),
        content: input.content.trim(),
        contentJson: input.contentJson,
        statusId,
        memberId: ctx.memberId,
        authorName: ctx.userName,
        authorEmail: ctx.userEmail,
      })

      // Add tags if provided
      if (input.tagIds && input.tagIds.length > 0) {
        await postRepo.setTags(post.id, input.tagIds)
      }

      // Auto-subscribe the author to their own post (within the same transaction)
      if (ctx.memberId) {
        const subscriptionService = new SubscriptionService()
        await subscriptionService.subscribeToPost(ctx.memberId, post.id, 'author', {
          db: uow.db,
        })
      }

      // Return post with board info for event building in API route
      return ok({ ...post, boardSlug: board.slug })
    })
  }

  /**
   * Update an existing post
   *
   * Validates that:
   * - Post exists and belongs to the organization
   * - User has permission to update the post
   * - Update data is valid
   *
   * @param id - Post ID to update
   * @param input - Update data
   * @param ctx - Service context with user/org information
   * @returns Result containing the updated post or an error
   */
  async updatePost(
    id: PostId,
    input: UpdatePostInput,
    ctx: ServiceContext
  ): Promise<Result<Post, PostError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Get existing post
      const existingPost = await postRepo.findById(id)
      if (!existingPost) {
        return err(PostError.notFound(id))
      }

      // Verify post belongs to this organization (via its board)
      const board = await boardRepo.findById(existingPost.boardId)
      if (!board) {
        return err(PostError.boardNotFound(existingPost.boardId))
      }

      // Authorization check - only team members (owner, admin, member) can update posts
      // Portal users don't have member records, so memberRole would be undefined
      if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(PostError.unauthorized('update this post'))
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
          const responseMemberId = input.officialResponseMemberId || ctx.memberId
          updateData.officialResponse = input.officialResponse
          updateData.officialResponseMemberId = responseMemberId
          updateData.officialResponseAuthorName = input.officialResponseAuthorName || ctx.userName
          updateData.officialResponseAt = new Date()
        }
      }

      // Update the post
      const updatedPost = await postRepo.update(id, updateData)
      if (!updatedPost) {
        return err(PostError.notFound(id))
      }

      // Update tags if provided
      if (input.tagIds !== undefined) {
        await postRepo.setTags(id, input.tagIds)
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
   * @param ctx - Service context with user/org information
   * @param options - Optional audit data (memberId, ipHash)
   * @returns Result containing vote status and new count, or an error
   */
  async voteOnPost(
    postId: PostId,
    userIdentifier: string,
    ctx: ServiceContext,
    options?: { memberId?: MemberId; ipHash?: string }
  ): Promise<Result<VoteResult, PostError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Verify post exists
      const post = await postRepo.findById(postId)
      if (!post) {
        return err(PostError.notFound(postId))
      }

      // Verify post belongs to this organization
      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(PostError.boardNotFound(post.boardId))
      }

      // Single atomic operation: check existing vote, then insert or delete + update count
      // Uses existing unique index on (post_id, user_identifier)
      // Convert TypeIDs to UUIDs for raw SQL query
      const postUuid = toUuid(postId)
      // Convert memberId TypeID to UUID for raw SQL
      const memberUuid = options?.memberId ? toUuid(options.memberId) : null
      const result = await uow.db.execute<{ vote_count: number; voted: boolean }>(sql`
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
        const subscriptionService = new SubscriptionService()
        await subscriptionService.subscribeToPost(options.memberId, postId, 'vote', {
          db: uow.db,
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
   * - User has permission to change status (team members only)
   * - New status is valid
   *
   * @param postId - Post ID to update
   * @param statusId - New status ID
   * @param ctx - Service context with user/org information
   * @returns Result containing the updated post or an error
   */
  async changeStatus(
    postId: PostId,
    statusId: StatusId,
    ctx: ServiceContext
  ): Promise<Result<ChangeStatusResult, PostError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Get existing post
      const existingPost = await postRepo.findById(postId)
      if (!existingPost) {
        return err(PostError.notFound(postId))
      }

      // Verify post belongs to this organization
      const board = await boardRepo.findById(existingPost.boardId)
      if (!board) {
        return err(PostError.boardNotFound(existingPost.boardId))
      }

      // Authorization check - only team members can change status
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(PostError.unauthorized('change post status'))
      }

      // Validate status exists (query the postStatuses table)
      const newStatus = await uow.db.query.postStatuses.findFirst({
        where: eq(postStatuses.id, statusId),
      })
      if (!newStatus) {
        return err(PostError.statusNotFound(statusId))
      }

      // Get previous status name for event
      let previousStatusName = 'Open'
      if (existingPost.statusId) {
        const prevStatus = await uow.db.query.postStatuses.findFirst({
          where: eq(postStatuses.id, existingPost.statusId),
        })
        if (prevStatus) {
          previousStatusName = prevStatus.name
        }
      }

      // Update the post status
      const updatedPost = await postRepo.update(postId, { statusId })
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
   * @param ctx - Service context with user/org information
   * @returns Result containing the post with details or an error
   */
  async getPostById(postId: PostId, _ctx: ServiceContext): Promise<Result<Post, PostError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      const post = await postRepo.findById(postId)
      if (!post) {
        return err(PostError.notFound(postId))
      }

      // Verify post belongs to this organization
      const board = await boardRepo.findById(post.boardId)
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
   * @param ctx - Service context with user/org information
   * @returns Result containing the post with details or an error
   */
  async getPostWithDetails(
    postId: PostId,
    _ctx: ServiceContext
  ): Promise<Result<PostWithDetails, PostError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Get the post
      const post = await postRepo.findById(postId)
      if (!post) {
        return err(PostError.notFound(postId))
      }

      // Get the board and verify it belongs to this organization
      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(PostError.boardNotFound(post.boardId))
      }

      // Get tags via postTags junction table
      const postTagsResult = await uow.db
        .select({
          id: tags.id,
          name: tags.name,
          color: tags.color,
        })
        .from(postTags)
        .innerJoin(tags, eq(tags.id, postTags.tagId))
        .where(eq(postTags.postId, postId))

      // Get comment count
      const [commentCountResult] = await uow.db
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
   * @param ctx - Service context with user/org information
   * @returns Result containing nested comment tree or an error
   */
  async getCommentsWithReplies(
    postId: PostId,
    userIdentifier: string,
    _ctx: ServiceContext
  ): Promise<Result<CommentTreeNode[], PostError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Verify post exists and belongs to organization
      const post = await postRepo.findById(postId)
      if (!post) {
        return err(PostError.notFound(postId))
      }

      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(PostError.boardNotFound(post.boardId))
      }

      // Get all comments with reactions
      const allComments = await uow.db.query.comments.findMany({
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
   * @param ctx - Service context with user/org information
   * @returns Result containing inbox post list or an error
   */
  async listInboxPosts(
    params: InboxPostListParams,
    _ctx: ServiceContext
  ): Promise<Result<InboxPostListResult, PostError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
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
            await uow.db.query.boards.findMany({
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
        const statusesBySlug = await uow.db.query.postStatuses.findMany({
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
        const postsWithSelectedTags = await uow.db
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
        uow.db.query.posts.findMany({
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
        uow.db
          .select({ count: sql<number>`count(*)::int` })
          .from(posts)
          .where(whereClause),
      ])

      // Get comment counts for all posts
      const postIds = rawPosts.map((p) => p.id)
      const commentCounts =
        postIds.length > 0
          ? await uow.db
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
   * @param ctx - Service context with user/org information
   * @returns Result containing posts for export or an error
   */
  async listPostsForExport(
    boardId: BoardId | undefined,
    _ctx: ServiceContext
  ): Promise<Result<PostForExport[], PostError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      // Build conditions
      const conditions = []

      // Get board IDs - either specific board or all boards
      const allBoardIds = boardId
        ? [boardId]
        : (
            await uow.db.query.boards.findMany({
              columns: { id: true },
            })
          ).map((b) => b.id)

      if (allBoardIds.length === 0) {
        return ok([])
      }

      conditions.push(inArray(posts.boardId, allBoardIds))

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get all posts with board and tags
      const rawPosts = await uow.db.query.posts.findMany({
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
          ? await uow.db.query.postStatuses.findMany({
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

  /**
   * Reconcile vote counts for all posts
   * Fixes any drift between actual vote count and stored vote_count
   *
   * @param ctx - Service context
   * @returns Result with number of posts fixed
   */
  async reconcileVoteCounts(_ctx: ServiceContext): Promise<Result<{ fixed: number }, PostError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      // Find and fix posts with mismatched counts in a single query
      const result = await uow.db.execute<{ id: string }>(sql`
        WITH mismatched AS (
          SELECT p.id, p.vote_count as stored, COUNT(v.id)::int as actual
          FROM posts p
          LEFT JOIN votes v ON v.post_id = p.id
          GROUP BY p.id
          HAVING p.vote_count != COUNT(v.id)
        )
        UPDATE posts p
        SET vote_count = m.actual
        FROM mismatched m
        WHERE p.id = m.id
        RETURNING p.id
      `)

      return ok({ fixed: result.length })
    })
  }

  // ============================================================================
  // User Edit/Delete Methods
  // ============================================================================

  /**
   * Check if a user can edit a post
   *
   * @param postId - Post ID to check
   * @param ctx - Service context with user/org information
   * @param portalConfig - Optional portal config (will fetch if not provided)
   * @returns Result containing permission check result
   */
  async canEditPost(
    postId: PostId,
    ctx: ServiceContext,
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
    if (ctx.memberRole && ['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return ok({ allowed: true })
    }

    // Must be the author
    if (post.memberId !== ctx.memberId) {
      return ok({ allowed: false, reason: 'You can only edit your own posts' })
    }

    // Get portal config if not provided
    const config = portalConfig ?? (await this.getPortalConfig())

    // Check if status is default (Open)
    const isDefaultStatus = await this.isDefaultStatus(post.statusId)
    if (!isDefaultStatus && !config.features.allowEditAfterEngagement) {
      return ok({ allowed: false, reason: 'Cannot edit posts that have been reviewed by the team' })
    }

    // Check for engagement (votes, comments from others)
    if (!config.features.allowEditAfterEngagement) {
      if (post.voteCount > 0) {
        return ok({ allowed: false, reason: 'Cannot edit posts that have received votes' })
      }

      const hasOtherComments = await this.hasCommentsFromOthers(postId, ctx.memberId)
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
   * @param ctx - Service context with user/org information
   * @param portalConfig - Optional portal config (will fetch if not provided)
   * @returns Result containing permission check result
   */
  async canDeletePost(
    postId: PostId,
    ctx: ServiceContext,
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
    if (ctx.memberRole && ['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return ok({ allowed: true })
    }

    // Must be the author
    if (post.memberId !== ctx.memberId) {
      return ok({ allowed: false, reason: 'You can only delete your own posts' })
    }

    // Get portal config if not provided
    const config = portalConfig ?? (await this.getPortalConfig())

    // Check if status is default (Open)
    const isDefaultStatus = await this.isDefaultStatus(post.statusId)
    if (!isDefaultStatus && !config.features.allowDeleteAfterEngagement) {
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
      const commentCount = await this.getCommentCount(postId)
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
   * @param ctx - Service context with user/org information
   * @returns Result containing updated post or error
   */
  async userEditPost(
    postId: PostId,
    input: UserEditPostInput,
    ctx: ServiceContext
  ): Promise<Result<Post, PostError>> {
    // Check permission first
    const permResult = await this.canEditPost(postId, ctx)
    if (!permResult.success) {
      return err(permResult.error)
    }
    if (!permResult.value.allowed) {
      return err(PostError.editNotAllowed(permResult.value.reason || 'Edit not allowed'))
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)

      // Get the existing post
      const existingPost = await postRepo.findById(postId)
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
      const config = await this.getPortalConfig()

      // Record edit history if enabled
      if (config.features.showPublicEditHistory && ctx.memberId) {
        await uow.db.insert(postEditHistory).values({
          postId: postId,
          editorMemberId: ctx.memberId,
          previousTitle: existingPost.title,
          previousContent: existingPost.content,
          previousContentJson: existingPost.contentJson,
        })
      }

      // Update the post
      const updatedPost = await postRepo.update(postId, {
        title: input.title.trim(),
        content: input.content.trim(),
        contentJson: input.contentJson,
        updatedAt: new Date(),
      })

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
   * @param ctx - Service context with user/org information
   * @returns Result indicating success or error
   */
  async softDeletePost(postId: PostId, ctx: ServiceContext): Promise<Result<void, PostError>> {
    // Check permission first
    const permResult = await this.canDeletePost(postId, ctx)
    if (!permResult.success) {
      return err(permResult.error)
    }
    if (!permResult.value.allowed) {
      return err(PostError.deleteNotAllowed(permResult.value.reason || 'Delete not allowed'))
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)

      // Set deletedAt and deletedByMemberId
      const updatedPost = await postRepo.update(postId, {
        deletedAt: new Date(),
        deletedByMemberId: ctx.memberId,
      })

      if (!updatedPost) {
        return err(PostError.notFound(postId))
      }

      return ok(undefined)
    })
  }

  /**
   * Restore a soft-deleted post (admin only)
   *
   * @param postId - Post ID to restore
   * @param ctx - Service context with user/org information
   * @returns Result containing restored post or error
   */
  async restorePost(postId: PostId, ctx: ServiceContext): Promise<Result<Post, PostError>> {
    // Only team members can restore
    if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return err(PostError.unauthorized('restore this post'))
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)

      // Get the post
      const existingPost = await postRepo.findById(postId)
      if (!existingPost) {
        return err(PostError.notFound(postId))
      }

      if (!existingPost.deletedAt) {
        return err(PostError.validationError('Post is not deleted'))
      }

      // Clear deletedAt and deletedByMemberId
      const restoredPost = await postRepo.update(postId, {
        deletedAt: null,
        deletedByMemberId: null,
      })

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
   * @param postId - Post ID to permanently delete
   * @param ctx - Service context with user/org information
   * @returns Result indicating success or error
   */
  async permanentDeletePost(postId: PostId, ctx: ServiceContext): Promise<Result<void, PostError>> {
    // Only team members can permanently delete
    if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return err(PostError.unauthorized('permanently delete this post'))
    }

    return withUnitOfWork(async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)

      const deleted = await postRepo.delete(postId)
      if (!deleted) {
        return err(PostError.notFound(postId))
      }

      return ok(undefined)
    })
  }

  /**
   * Get edit history for a post
   *
   * @param postId - Post ID to get history for
   * @param ctx - Service context with user/org information
   * @returns Result containing array of edit history entries
   */
  async getPostEditHistory(
    postId: PostId,
    _ctx: ServiceContext
  ): Promise<Result<PostEditHistoryEntry[], PostError>> {
    const { db } = await import('@quackback/db')

    const history = await db
      .select({
        id: postEditHistory.id,
        postId: postEditHistory.postId,
        editorMemberId: postEditHistory.editorMemberId,
        previousTitle: postEditHistory.previousTitle,
        previousContent: postEditHistory.previousContent,
        previousContentJson: postEditHistory.previousContentJson,
        createdAt: postEditHistory.createdAt,
      })
      .from(postEditHistory)
      .where(eq(postEditHistory.postId, postId))
      .orderBy(desc(postEditHistory.createdAt))

    // Map to the expected type
    const entries: PostEditHistoryEntry[] = history.map((h) => ({
      id: h.id,
      postId: h.postId,
      editorMemberId: h.editorMemberId,
      editorName: null, // We'd need to join to user table for name
      previousTitle: h.previousTitle,
      previousContent: h.previousContent,
      previousContentJson: h.previousContentJson,
      createdAt: h.createdAt,
    }))

    return ok(entries)
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Check if a status is the default "open" status
   */
  private async isDefaultStatus(statusId: StatusId | null): Promise<boolean> {
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
  private async hasCommentsFromOthers(
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
  private async getCommentCount(postId: PostId): Promise<number> {
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
  private async getPortalConfig(): Promise<PortalConfig> {
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
}

/**
 * Singleton instance of PostService
 * Export as default for easy importing
 */
export const postService = new PostService()
