'use server'

import { z } from 'zod'
import { withAction, mapDomainError } from './with-action'
import { actionOk, actionErr } from './types'
import { getPostService, getMemberService, getRoadmapService } from '@/lib/services'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { buildPostCreatedEvent, buildPostStatusChangedEvent } from '@quackback/domain'
import type { CommentTreeNode } from '@quackback/domain'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getJobAdapter, isCloudflareWorker } from '@quackback/jobs'
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
export const listInboxPostsAction = withAction(
  listInboxPostsSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getPostService().listInboxPosts(
      {
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
      },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  }
)

/**
 * Create a new post.
 */
export const createPostAction = withAction(
  createPostSchema,
  async (input, ctx, serviceCtx) => {
    const result = await getPostService().createPost(
      {
        title: input.title,
        content: input.content,
        contentJson: input.contentJson,
        boardId: input.boardId as BoardId,
        statusId: input.statusId as StatusId | undefined,
        tagIds: (input.tagIds || []) as TagId[],
      },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    // Trigger EventWorkflow for integrations and notifications
    const { boardSlug, ...post } = result.value
    const eventData = buildPostCreatedEvent(
      ctx.settings.id,
      { type: 'user', userId: serviceCtx.userId, email: serviceCtx.userEmail },
      {
        id: post.id,
        title: post.title,
        content: post.content,
        boardId: post.boardId,
        boardSlug,
        authorEmail: serviceCtx.userEmail,
        voteCount: post.voteCount,
      }
    )
    const env = isCloudflareWorker() ? getCloudflareContext().env : undefined
    const jobAdapter = getJobAdapter(env)
    await jobAdapter.addEventJob(eventData)

    return actionOk(post)
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Get a post with full details including comments, votes, and avatars.
 */
export const getPostWithDetailsAction = withAction(
  getPostSchema,
  async (input, ctx, serviceCtx) => {
    const postId = input.id as PostId

    // Get post with details
    const postResult = await getPostService().getPostWithDetails(postId, serviceCtx)
    if (!postResult.success) {
      return actionErr(mapDomainError(postResult.error))
    }

    const post = postResult.value

    // Get comments with reactions in nested format
    const commentsResult = await getPostService().getCommentsWithReplies(
      postId,
      `member:${ctx.member.id}`,
      serviceCtx
    )
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
    const userIdentifier = getMemberIdentifier(ctx.member.id)
    const hasVotedResult = await getPostService().hasUserVotedOnPost(postId, userIdentifier)
    const hasVoted = hasVotedResult.success ? hasVotedResult.value : false

    // Get roadmap IDs this post belongs to
    const roadmapsResult = await getRoadmapService().getPostRoadmaps(postId, serviceCtx)
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
  }
)

/**
 * Update a post (title, content, owner, official response).
 */
export const updatePostAction = withAction(
  updatePostSchema,
  async (input, ctx, serviceCtx) => {
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
        const ownerMemberResult = await getMemberService().getMemberByUser(
          input.ownerId as UserId
        )
        const ownerMember = ownerMemberResult.success ? ownerMemberResult.value : null
        updateInput.ownerMemberId = ownerMember ? ownerMember.id : null
      } else {
        updateInput.ownerMemberId = null
      }
    }

    // Handle official response update
    if (input.officialResponse !== undefined) {
      if (input.officialResponse === null || input.officialResponse === '') {
        updateInput.officialResponse = null
        updateInput.officialResponseMemberId = null
        updateInput.officialResponseAuthorName = null
      } else {
        updateInput.officialResponse = input.officialResponse
        updateInput.officialResponseMemberId = ctx.member.id as MemberId
        updateInput.officialResponseAuthorName = ctx.user.name || ctx.user.email
      }
    }

    const result = await getPostService().updatePost(postId, updateInput, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Delete a post (soft or permanent).
 */
export const deletePostAction = withAction(
  deletePostSchema,
  async (input, _ctx, serviceCtx) => {
    const postId = input.id as PostId
    const postService = getPostService()

    const result = input.permanent
      ? await postService.permanentDeletePost(postId, serviceCtx)
      : await postService.softDeletePost(postId, serviceCtx)

    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Change post status.
 */
export const changePostStatusAction = withAction(
  changeStatusSchema,
  async (input, _ctx, serviceCtx) => {
    const postId = input.id as PostId
    const statusId = input.statusId as StatusId

    const result = await getPostService().changeStatus(postId, statusId, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    // Trigger EventWorkflow for integrations and notifications
    const { boardSlug, previousStatus, newStatus, ...post } = result.value
    const eventData = buildPostStatusChangedEvent(
      _ctx.settings.id,
      { type: 'user', userId: serviceCtx.userId, email: serviceCtx.userEmail },
      { id: post.id, title: post.title, boardSlug },
      previousStatus,
      newStatus
    )
    const env = isCloudflareWorker() ? getCloudflareContext().env : undefined
    const jobAdapter = getJobAdapter(env)
    await jobAdapter.addEventJob(eventData)

    return actionOk(post)
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Update tags assigned to a post.
 */
export const updatePostTagsAction = withAction(
  updateTagsSchema,
  async (input, _ctx, serviceCtx) => {
    const postId = input.id as PostId

    // Validate tag TypeIDs
    const validatedTagIds = input.tagIds.map((id) => {
      if (!isValidTypeId(id, 'tag')) {
        throw new Error(`Invalid tag ID format: ${id}`)
      }
      return id as TagId
    })

    const result = await getPostService().updatePost(
      postId,
      { tagIds: validatedTagIds },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Restore a soft-deleted post.
 */
export const restorePostAction = withAction(
  restorePostSchema,
  async (input, _ctx, serviceCtx) => {
    const postId = input.id as PostId

    const result = await getPostService().restorePost(postId, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin'] }
)
