import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, eq } from '@/lib/db'
import { actionOk, actionErr, mapDomainError, type ActionResult } from './types'
import {
  createPost,
  updatePost,
  listInboxPosts,
  getPostWithDetails,
  getCommentsWithReplies,
  changeStatus,
  softDeletePost,
  permanentDeletePost,
  restorePost,
  hasUserVoted,
} from '@/lib/posts'
import { getMemberByUser } from '@/lib/members'
import { getPostRoadmaps } from '@/lib/roadmaps'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { buildPostCreatedEvent, buildPostStatusChangedEvent } from '@/lib/events'
import type { CommentTreeNode } from '@/lib/shared'
import { getJobAdapter } from '@quackback/jobs'
import {
  postIdSchema,
  boardIdSchema,
  statusIdSchema,
  tagIdSchema,
  memberIdSchema,
  isValidTypeId,
  type PostId,
  type BoardId,
  type StatusId,
  type TagId,
  type MemberId,
  type UserId,
} from '@quackback/ids'

// ============================================
// Helper Functions
// ============================================

/**
 * Recursively collect all member IDs from comments and their nested replies
 */
function collectCommentMemberIds(comments: CommentTreeNode[]): MemberId[] {
  const memberIds: MemberId[] = []
  for (const comment of comments) {
    if (comment.memberId) {
      memberIds.push(comment.memberId as MemberId)
    }
    if (comment.replies.length > 0) {
      memberIds.push(...collectCommentMemberIds(comment.replies))
    }
  }
  return memberIds
}

// ============================================
// Schemas
// ============================================

// TipTap JSON content schema
const tiptapContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.any()).optional(),
})

const listInboxPostsSchema = z.object({
  boardIds: z.array(boardIdSchema).optional(),
  statusIds: z.array(statusIdSchema).optional(),
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(tagIdSchema).optional(),
  ownerId: z.union([memberIdSchema, z.null()]).optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minVotes: z.number().int().min(0).optional(),
  sort: z.enum(['newest', 'oldest', 'votes']).optional().default('newest'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

const createPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Description is required').max(10000),
  contentJson: tiptapContentSchema.optional(),
  boardId: boardIdSchema,
  statusId: statusIdSchema.optional(),
  tagIds: z.array(tagIdSchema).optional().default([]),
})

const getPostSchema = z.object({
  id: postIdSchema,
})

const updatePostSchema = z.object({
  id: postIdSchema,
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(10000).optional(),
  contentJson: tiptapContentSchema.optional(),
  ownerId: z.union([z.string(), z.null()]).optional(),
  officialResponse: z.union([z.string(), z.null()]).optional(),
})

const deletePostSchema = z.object({
  id: postIdSchema,
  permanent: z.boolean().optional().default(false),
})

const changeStatusSchema = z.object({
  id: postIdSchema,
  statusId: statusIdSchema,
})

const updateTagsSchema = z.object({
  id: postIdSchema,
  tagIds: z.array(z.string()),
})

const restorePostSchema = z.object({
  id: postIdSchema,
})

// ============================================
// Type Exports
// ============================================

export type ListInboxPostsInput = z.infer<typeof listInboxPostsSchema>
export type CreatePostInput = z.infer<typeof createPostSchema>
export type GetPostInput = z.infer<typeof getPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>
export type DeletePostInput = z.infer<typeof deletePostSchema>
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>
export type UpdateTagsInput = z.infer<typeof updateTagsSchema>
export type RestorePostInput = z.infer<typeof restorePostSchema>

// ============================================
// Actions
// ============================================

/**
 * List inbox posts with filtering, sorting, and pagination.
 */
export const listInboxPostsAction = createServerFn({ method: 'POST' })
  .inputValidator(listInboxPostsSchema)
  .handler(async ({ data: input }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const result = await listInboxPosts({
      boardIds: input.boardIds as BoardId[] | undefined,
      statusIds: input.statusIds as StatusId[] | undefined,
      statusSlugs: input.statusSlugs,
      tagIds: input.tagIds as TagId[] | undefined,
      ownerId: input.ownerId as MemberId | null | undefined,
      search: input.search,
      dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
      dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
      minVotes: input.minVotes,
      sort: input.sort,
      page: input.page,
      limit: input.limit,
    })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Create a new post.
 */
export const createPostAction = createServerFn({ method: 'POST' })
  .inputValidator(createPostSchema)
  .handler(async ({ data: input }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const author = {
      memberId: memberRecord.id as MemberId,
      name: session.user.name || session.user.email,
      email: session.user.email,
    }

    const result = await createPost(
      {
        title: input.title,
        content: input.content,
        contentJson: input.contentJson,
        boardId: input.boardId as BoardId,
        statusId: input.statusId as StatusId | undefined,
        tagIds: (input.tagIds || []) as TagId[],
      },
      author
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    // Trigger EventWorkflow for integrations and notifications
    const { boardSlug, ...post } = result.value
    const eventData = buildPostCreatedEvent(
      { type: 'user', userId: session.user.id as UserId, email: session.user.email },
      {
        id: post.id,
        title: post.title,
        content: post.content,
        boardId: post.boardId,
        boardSlug,
        authorEmail: session.user.email,
        voteCount: post.voteCount,
      }
    )

    const jobAdapter = getJobAdapter()
    await jobAdapter.addEventJob(eventData)

    return actionOk(post)
  })

/**
 * Get a post with full details including comments, votes, and avatars.
 */
export const getPostWithDetailsAction = createServerFn({ method: 'POST' })
  .inputValidator(getPostSchema)
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const postId = data.id as PostId

    // Get post with details
    const postResult = await getPostWithDetails(postId)
    if (!postResult.success) {
      return actionErr(mapDomainError(postResult.error))
    }

    const post = postResult.value

    // Get comments with reactions in nested format
    const commentsResult = await getCommentsWithReplies(postId, `member:${memberRecord.id}`)
    if (!commentsResult.success) {
      return actionErr(mapDomainError(commentsResult.error))
    }

    const commentsWithReplies = commentsResult.value

    // Collect member IDs from post author and all comments for avatar lookup
    const memberIds: MemberId[] = []
    if (post.memberId) memberIds.push(post.memberId as MemberId)
    memberIds.push(...collectCommentMemberIds(commentsWithReplies))

    // Fetch avatar URLs for all members
    const avatarMap = await getBulkMemberAvatarData(memberIds)

    // Check if current user has voted on this post
    const userIdentifier = getMemberIdentifier(memberRecord.id)
    const hasVotedResult = await hasUserVoted(postId, userIdentifier)
    const hasVoted = hasVotedResult.success ? hasVotedResult.value : false

    // Get roadmap IDs this post belongs to
    const roadmapsResult = await getPostRoadmaps(postId)
    const roadmapIds = roadmapsResult.success ? roadmapsResult.value.map((r) => r.id) : []

    const responseData = {
      ...post,
      comments: commentsWithReplies,
      hasVoted,
      roadmapIds,
      officialResponse: post.officialResponse
        ? {
            content: post.officialResponse,
            authorName: post.officialResponseAuthorName,
            respondedAt: post.officialResponseAt,
          }
        : null,
      avatarUrls: Object.fromEntries(avatarMap),
    }

    return actionOk(responseData)
  })

/**
 * Update a post (title, content, owner, official response).
 */
export const updatePostAction = createServerFn({ method: 'POST' })
  .inputValidator(updatePostSchema)
  .handler(async ({ data: input }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const postId = input.id as PostId

    // Build update input
    const updateInput: {
      title?: string
      content?: string
      contentJson?: unknown
      ownerId?: string | null
      ownerMemberId?: MemberId | null
      officialResponse?: string | null
      officialResponseMemberId?: MemberId | null
      officialResponseAuthorName?: string | null
    } = {}

    if (input.title !== undefined) updateInput.title = input.title
    if (input.content !== undefined) updateInput.content = input.content
    if (input.contentJson !== undefined) updateInput.contentJson = input.contentJson

    // Handle owner update
    if (input.ownerId !== undefined) {
      updateInput.ownerId = input.ownerId
      if (input.ownerId) {
        const ownerMemberResult = await getMemberByUser(input.ownerId as UserId)
        const ownerMember = ownerMemberResult.success ? ownerMemberResult.value : null
        updateInput.ownerMemberId = ownerMember ? ownerMember.id : null
      } else {
        updateInput.ownerMemberId = null
      }
    }

    // Handle official response update - pass responder info to service
    if (input.officialResponse !== undefined) {
      if (input.officialResponse === null || input.officialResponse === '') {
        updateInput.officialResponse = null
        updateInput.officialResponseMemberId = null
        updateInput.officialResponseAuthorName = null
      } else {
        updateInput.officialResponse = input.officialResponse
        // Let the service layer use the responder info
      }
    }

    // Build responder info for official response
    const responder = {
      memberId: memberRecord.id as MemberId,
      name: session.user.name || session.user.email,
    }

    const result = await updatePost(postId, updateInput, responder)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Delete a post (soft or permanent).
 */
export const deletePostAction = createServerFn({ method: 'POST' })
  .inputValidator(deletePostSchema)
  .handler(async ({ data: input }): Promise<ActionResult<{ success: boolean }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const postId = input.id as PostId

    // Build actor info for soft delete (permission check)
    const actor = {
      memberId: memberRecord.id as MemberId,
      role: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
    }

    const result = input.permanent
      ? await permanentDeletePost(postId)
      : await softDeletePost(postId, actor)

    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  })

/**
 * Change post status.
 */
export const changePostStatusAction = createServerFn({ method: 'POST' })
  .inputValidator(changeStatusSchema)
  .handler(async ({ data: input }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const postId = input.id as PostId
    const statusId = input.statusId as StatusId

    const result = await changeStatus(postId, statusId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    // Trigger EventWorkflow for integrations and notifications
    const { boardSlug, previousStatus, newStatus, ...post } = result.value
    const eventData = buildPostStatusChangedEvent(
      { type: 'user', userId: session.user.id as UserId, email: session.user.email },
      { id: post.id, title: post.title, boardSlug },
      previousStatus,
      newStatus
    )

    const jobAdapter = getJobAdapter()
    await jobAdapter.addEventJob(eventData)

    return actionOk(post)
  })

/**
 * Update tags assigned to a post.
 */
export const updatePostTagsAction = createServerFn({ method: 'POST' })
  .inputValidator(updateTagsSchema)
  .handler(async ({ data: input }): Promise<ActionResult<{ success: boolean }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const postId = input.id as PostId

    // Validate tag TypeIDs
    const validatedTagIds = input.tagIds.map((id) => {
      if (!isValidTypeId(id, 'tag')) {
        throw new Error(`Invalid tag ID format: ${id}`)
      }
      return id as TagId
    })

    const result = await updatePost(postId, { tagIds: validatedTagIds })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  })

/**
 * Restore a soft-deleted post.
 */
export const restorePostAction = createServerFn({ method: 'POST' })
  .inputValidator(restorePostSchema)
  .handler(async ({ data }): Promise<ActionResult<{ success: boolean }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const postId = data.id as PostId

    const result = await restorePost(postId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  })
