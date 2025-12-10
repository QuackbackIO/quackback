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
  or,
  ilike,
  inArray,
  desc,
  asc,
  sql,
  votes,
  postStatuses,
  posts,
  boards,
  postTags,
  tags,
  comments,
  type Post,
  type UnitOfWork,
} from '@quackback/db'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { PostError } from './post.errors'
import { buildCommentTree, type CommentTreeNode } from '../shared/comment-tree'
import type {
  CreatePostInput,
  UpdatePostInput,
  VoteResult,
  PostWithDetails,
  PublicPostListResult,
  InboxPostListParams,
  InboxPostListResult,
  PostForExport,
  RoadmapPost,
  PublicPostDetail,
  PublicComment,
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
  async createPost(input: CreatePostInput, ctx: ServiceContext): Promise<Result<Post, PostError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
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

      // Create the post with member-scoped identity
      const post = await postRepo.create({
        boardId: input.boardId,
        title: input.title.trim(),
        content: input.content.trim(),
        contentJson: input.contentJson,
        status: input.status || 'open',
        memberId: ctx.memberId,
        // Legacy fields for display compatibility
        authorName: ctx.userName,
        authorEmail: ctx.userEmail,
      })

      // Add tags if provided
      if (input.tagIds && input.tagIds.length > 0) {
        await postRepo.setTags(post.id, input.tagIds)
      }

      return ok(post)
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
    id: string,
    input: UpdatePostInput,
    ctx: ServiceContext
  ): Promise<Result<Post, PostError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
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
      if (input.status !== undefined) updateData.status = input.status
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
          updateData.officialResponse = input.officialResponse
          updateData.officialResponseMemberId = input.officialResponseMemberId || ctx.memberId
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
    postId: string,
    userIdentifier: string,
    ctx: ServiceContext,
    options?: { memberId?: string; ipHash?: string }
  ): Promise<Result<VoteResult, PostError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
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
      const result = await uow.db.execute<{ vote_count: number; voted: boolean }>(sql`
        WITH existing_vote AS (
          SELECT id FROM votes
          WHERE post_id = ${postId} AND user_identifier = ${userIdentifier}
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
          INSERT INTO votes (post_id, user_identifier, member_id, ip_hash, updated_at)
          SELECT ${postId}, ${userIdentifier}, ${options?.memberId ?? null}, ${options?.ipHash ?? null}, NOW()
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
        WHERE id = ${postId}
        RETURNING vote_count, (SELECT is_new_vote FROM combined LIMIT 1) AS voted
      `)

      const row = result[0]
      return ok({
        voted: row?.voted ?? false,
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
    postId: string,
    statusId: string,
    ctx: ServiceContext
  ): Promise<Result<Post, PostError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
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
      const status = await uow.db.query.postStatuses.findFirst({
        where: eq(postStatuses.id, statusId),
      })
      if (!status) {
        return err(PostError.statusNotFound(statusId))
      }

      // Update the post status
      const updatedPost = await postRepo.update(postId, { statusId })
      if (!updatedPost) {
        return err(PostError.notFound(postId))
      }

      return ok(updatedPost)
    })
  }

  /**
   * Get a post by ID with details
   *
   * @param postId - Post ID to fetch
   * @param ctx - Service context with user/org information
   * @returns Result containing the post with details or an error
   */
  async getPostById(postId: string, ctx: ServiceContext): Promise<Result<Post, PostError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
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
    postId: string,
    ctx: ServiceContext
  ): Promise<Result<PostWithDetails, PostError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
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
          organizationId: board.organizationId,
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
    postId: string,
    userIdentifier: string,
    ctx: ServiceContext
  ): Promise<Result<CommentTreeNode[], PostError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
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
   * List posts for public portal (no authentication required)
   *
   * @param params - Query parameters including organizationId, boardSlug, search, status, sort, pagination
   * @returns Result containing public post list or an error
   */
  async listPublicPosts(params: {
    organizationId: string
    boardSlug?: string
    search?: string
    status?: string[]
    tagIds?: string[]
    sort?: 'top' | 'new' | 'trending'
    page?: number
    limit?: number
  }): Promise<Result<PublicPostListResult, PostError>> {
    // Note: This is a PUBLIC method, no auth context needed
    // We use organizationId directly in withUnitOfWork
    return withUnitOfWork(params.organizationId, async (uow: UnitOfWork) => {
      const { boardSlug, search, status, tagIds, sort = 'top', page = 1, limit = 20 } = params
      const offset = (page - 1) * limit

      // Build where conditions - only include posts from public boards
      const conditions = [
        eq(boards.organizationId, params.organizationId),
        eq(boards.isPublic, true),
      ]

      if (boardSlug) {
        conditions.push(eq(boards.slug, boardSlug))
      }

      if (status && status.length > 0) {
        conditions.push(inArray(posts.status, status as any))
      }

      // Tag filter - posts must have at least one of the selected tags
      if (tagIds && tagIds.length > 0) {
        const postsWithSelectedTags = await uow.db
          .selectDistinct({ postId: postTags.postId })
          .from(postTags)
          .where(inArray(postTags.tagId, tagIds))

        const postIdsWithTags = postsWithSelectedTags.map((p) => p.postId)

        if (postIdsWithTags.length === 0) {
          return ok({ items: [], total: 0, hasMore: false })
        }
        conditions.push(inArray(posts.id, postIdsWithTags))
      }

      if (search) {
        conditions.push(or(ilike(posts.title, `%${search}%`), ilike(posts.content, `%${search}%`))!)
      }

      // Get total count
      const [countResult] = await uow.db
        .select({ count: sql<number>`count(*)::int` })
        .from(posts)
        .innerJoin(boards, eq(posts.boardId, boards.id))
        .where(and(...conditions))

      const total = countResult?.count || 0

      // Determine sort order
      const orderBy =
        sort === 'new'
          ? desc(posts.createdAt)
          : sort === 'trending'
            ? sql`(${posts.voteCount} / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - ${posts.createdAt})) / 86400)) DESC`
            : desc(posts.voteCount) // 'top' is default

      // Get posts with board info
      const postsResult = await uow.db
        .select({
          id: posts.id,
          title: posts.title,
          content: posts.content,
          status: posts.status,
          voteCount: posts.voteCount,
          authorName: posts.authorName,
          memberId: posts.memberId,
          createdAt: posts.createdAt,
          commentCount: sql<number>`(
            SELECT count(*)::int FROM comments WHERE comments.post_id = ${posts.id}
          )`,
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

      // Get tags for all posts
      const postIds = postsResult.map((p) => p.id)
      const tagsResult =
        postIds.length > 0
          ? await uow.db
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
      const tagsByPost = new Map<string, Array<{ id: string; name: string; color: string }>>()
      for (const row of tagsResult) {
        const existing = tagsByPost.get(row.postId) || []
        existing.push({ id: row.id, name: row.name, color: row.color })
        tagsByPost.set(row.postId, existing)
      }

      const items = postsResult.map((post) => ({
        id: post.id,
        title: post.title,
        content: post.content,
        status: post.status,
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

      return ok({
        items,
        total,
        hasMore: offset + items.length < total,
      })
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
    ctx: ServiceContext
  ): Promise<Result<InboxPostListResult, PostError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const {
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

      // Get board IDs for this organization
      const orgBoardIds = boardIds?.length
        ? boardIds
        : (
            await uow.db.query.boards.findMany({
              where: eq(boards.organizationId, ctx.organizationId),
              columns: { id: true },
            })
          ).map((b) => b.id)

      if (orgBoardIds.length === 0) {
        return ok({ items: [], total: 0, hasMore: false })
      }

      conditions.push(inArray(posts.boardId, orgBoardIds))

      // Status filter (multiple statuses = OR)
      if (status && status.length > 0) {
        conditions.push(inArray(posts.status, status as any))
      }

      // Owner filter
      if (ownerId === null) {
        conditions.push(sql`${posts.ownerId} IS NULL`)
      } else if (ownerId) {
        conditions.push(eq(posts.ownerId, ownerId))
      }

      // Search filter
      if (search) {
        conditions.push(or(ilike(posts.title, `%${search}%`), ilike(posts.content, `%${search}%`))!)
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
      let postIdsWithTags: string[] | null = null
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
    boardId: string | undefined,
    ctx: ServiceContext
  ): Promise<Result<PostForExport[], PostError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      // Build conditions
      const conditions = []

      // Get board IDs for this organization
      const orgBoardIds = boardId
        ? [boardId]
        : (
            await uow.db.query.boards.findMany({
              where: eq(boards.organizationId, ctx.organizationId),
              columns: { id: true },
            })
          ).map((b) => b.id)

      if (orgBoardIds.length === 0) {
        return ok([])
      }

      conditions.push(inArray(posts.boardId, orgBoardIds))

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
        status: post.status,
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
   * Get a single post with full details for public view
   * No authentication required - only returns posts from public boards
   *
   * @param postId - Post ID to fetch
   * @param userIdentifier - Optional user identifier for reaction tracking
   * @returns Result containing post detail or null if not found/not public
   */
  async getPublicPostDetail(
    postId: string,
    userIdentifier?: string
  ): Promise<Result<PublicPostDetail | null, PostError>> {
    // Use db from tenant-context for public queries (no UnitOfWork needed - read-only)
    const { db } = await import('@quackback/db')

    const postResult = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: {
        board: true,
      },
    })

    if (!postResult || !postResult.board.isPublic) {
      return ok(null)
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

    // Get comments with reactions
    const commentsResult = await db.query.comments.findMany({
      where: eq(comments.postId, postId),
      with: {
        reactions: true,
      },
      orderBy: asc(comments.createdAt),
    })

    // Build nested comment tree
    const commentTree = buildCommentTree(commentsResult, userIdentifier)

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

    return ok({
      id: postResult.id,
      title: postResult.title,
      content: postResult.content,
      contentJson: postResult.contentJson,
      status: postResult.status,
      voteCount: postResult.voteCount,
      authorName: postResult.authorName,
      createdAt: postResult.createdAt,
      board: {
        id: postResult.board.id,
        name: postResult.board.name,
        slug: postResult.board.slug,
      },
      tags: tagsResult,
      comments: rootComments,
      officialResponse: postResult.officialResponse
        ? {
            content: postResult.officialResponse,
            authorName: postResult.officialResponseAuthorName,
            respondedAt: postResult.officialResponseAt!,
          }
        : null,
    })
  }

  /**
   * Get posts for roadmap view across all public boards
   * No authentication required
   *
   * @param organizationId - Organization ID
   * @param statusSlugs - Array of status slugs to filter by
   * @returns Result containing roadmap posts
   */
  async getRoadmapPosts(
    organizationId: string,
    statusSlugs: string[]
  ): Promise<Result<RoadmapPost[], PostError>> {
    if (statusSlugs.length === 0) {
      return ok([])
    }

    const { db } = await import('@quackback/db')

    const result = await db
      .select({
        id: posts.id,
        title: posts.title,
        status: posts.status,
        voteCount: posts.voteCount,
        boardId: boards.id,
        boardName: boards.name,
        boardSlug: boards.slug,
      })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(
        and(
          eq(boards.organizationId, organizationId),
          eq(boards.isPublic, true),
          inArray(posts.status, statusSlugs as any)
        )
      )
      .orderBy(desc(posts.voteCount))

    return ok(
      result.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        voteCount: row.voteCount,
        board: {
          id: row.boardId,
          name: row.boardName,
          slug: row.boardSlug,
        },
      }))
    )
  }

  /**
   * Check if a user has voted on a post
   * No authentication required
   *
   * @param postId - Post ID to check
   * @param userIdentifier - User's identifier
   * @returns Result containing boolean
   */
  async hasUserVotedOnPost(
    postId: string,
    userIdentifier: string
  ): Promise<Result<boolean, PostError>> {
    const { db } = await import('@quackback/db')

    const vote = await db.query.votes.findFirst({
      where: and(eq(votes.postId, postId), eq(votes.userIdentifier, userIdentifier)),
    })

    return ok(!!vote)
  }

  /**
   * Get which posts a user has voted on from a list
   * No authentication required
   *
   * @param postIds - List of post IDs to check
   * @param userIdentifier - User's identifier
   * @returns Result containing Set of voted post IDs
   */
  async getUserVotedPostIds(
    postIds: string[],
    userIdentifier: string
  ): Promise<Result<Set<string>, PostError>> {
    if (postIds.length === 0) {
      return ok(new Set())
    }

    const { db } = await import('@quackback/db')

    const result = await db
      .select({ postId: votes.postId })
      .from(votes)
      .where(and(inArray(votes.postId, postIds), eq(votes.userIdentifier, userIdentifier)))

    return ok(new Set(result.map((r) => r.postId)))
  }

  /**
   * Get board by post ID
   * No authentication required
   *
   * @param postId - Post ID to lookup
   * @returns Result containing Board or null
   */
  async getBoardByPostId(
    postId: string
  ): Promise<Result<import('@quackback/db').Board | null, PostError>> {
    const { db } = await import('@quackback/db')

    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: { board: true },
    })

    return ok(post?.board || null)
  }

  /**
   * Reconcile vote counts for all posts in an organization
   * Fixes any drift between actual vote count and stored vote_count
   *
   * @param ctx - Service context with organization info
   * @returns Result with number of posts fixed
   */
  async reconcileVoteCounts(ctx: ServiceContext): Promise<Result<{ fixed: number }, PostError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      // Find and fix posts with mismatched counts in a single query
      const result = await uow.db.execute<{ id: string }>(sql`
        WITH mismatched AS (
          SELECT p.id, p.vote_count as stored, COUNT(v.id)::int as actual
          FROM posts p
          INNER JOIN boards b ON p.board_id = b.id
          LEFT JOIN votes v ON v.post_id = p.id
          WHERE b.organization_id = ${ctx.organizationId}
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
}

/**
 * Singleton instance of PostService
 * Export as default for easy importing
 */
export const postService = new PostService()
