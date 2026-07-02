/**
 * Server functions for post operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import {
  type PostId,
  type BoardId,
  type PostStatusId,
  type PostTagId,
  type SegmentId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { tiptapContentSchema, type TiptapContent } from '@/lib/shared/schemas/posts'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { can } from '@/lib/server/policy/authorize'
import { db, eq, posts } from '@/lib/server/db'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import { getMemberById } from '@/lib/server/domains/principals/principal.service'
import { createPost, updatePost } from '@/lib/server/domains/posts/post.service'
import { listInboxPosts } from '@/lib/server/domains/posts/post.inbox'
import { getPostWithDetails, getCommentsWithReplies } from '@/lib/server/domains/posts/post.query'
import { getPostFeedbackSource } from '@/lib/server/domains/posts/post.export'
import { changeStatus } from '@/lib/server/domains/posts/post.status'
import { changeBoard } from '@/lib/server/domains/posts/post.board'
import { softDeletePost, restorePost } from '@/lib/server/domains/posts/post.user-actions'
import {
  getPostExternalLinks,
  executeCascadeDelete,
} from '@/lib/server/domains/posts/post.cascade-delete'
import { hasUserVoted } from '@/lib/server/domains/posts/post.public.utils'
import { getMergedPosts, getPostMergeInfo } from '@/lib/server/domains/posts/post.merge'
import { getPostVoters, addVoteOnBehalf, removeVote } from '@/lib/server/domains/posts/post.voting'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'posts' })

/**
 * Serialize common post date fields for API responses.
 */
function serializePostDates<
  T extends {
    createdAt: Date | string
    updatedAt: Date | string
    deletedAt?: Date | string | null
    eta?: Date | string | null
  },
>(
  post: T
): Omit<T, 'createdAt' | 'updatedAt' | 'deletedAt' | 'eta'> & {
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  eta: string | null
} {
  return {
    ...post,
    createdAt: toIsoString(post.createdAt),
    updatedAt: toIsoString(post.updatedAt),
    deletedAt: toIsoStringOrNull(post.deletedAt),
    eta: toIsoStringOrNull(post.eta),
  }
}

// ============================================
// Schemas
// ============================================

// tiptapContentSchema imported from @/lib/shared/schemas/posts

const listInboxPostsSchema = z.object({
  boardIds: z.array(z.string()).optional(),
  statusIds: z.array(z.string()).optional(),
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  segmentIds: z.array(z.string()).optional(),
  ownerId: z.union([z.string(), z.null()]).optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minVotes: z.number().int().min(0).optional(),
  minComments: z.number().int().min(0).optional(),
  responded: z.enum(['all', 'responded', 'unresponded']).optional(),
  updatedBefore: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'votes']).optional().default('newest'),
  showDeleted: z.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

const createPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000).optional().default(''),
  contentJson: tiptapContentSchema.optional(),
  boardId: z.string(),
  statusId: z.string().optional(),
  tagIds: z.array(z.string()).optional().default([]),
  authorPrincipalId: z.string().optional(),
})

const getPostSchema = z.object({
  id: z.string(),
})

const updatePostSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(10000).optional(),
  contentJson: tiptapContentSchema.optional(),
})

const setPostOwnerSchema = z.object({
  id: z.string(),
  ownerId: z.string().nullable(),
})

const setPostEtaSchema = z.object({
  id: z.string(),
  // ISO datetime (first of the target month) or null to clear.
  eta: z.string().datetime().nullable(),
})

const deletePostSchema = z.object({
  id: z.string(),
  cascadeChoices: z
    .array(
      z.object({
        linkId: z.string(),
        shouldArchive: z.boolean(),
      })
    )
    .optional(),
})

const changeStatusSchema = z.object({
  id: z.string(),
  statusId: z.string(),
})

const changePostBoardSchema = z.object({
  id: z.string(),
  boardId: z.string(),
})

const updateTagsSchema = z.object({
  id: z.string(),
  tagIds: z.array(z.string()),
})

const restorePostSchema = z.object({
  id: z.string(),
})

const toggleCommentsLockSchema = z.object({
  id: z.string(),
  locked: z.boolean(),
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
// Read Operations
// ============================================

/**
 * List inbox posts with filtering, sorting, and pagination
 */
export const fetchInboxPostsForAdmin = createServerFn({ method: 'GET' })
  .validator(listInboxPostsSchema)
  .handler(async ({ data }) => {
    log.debug('fetch inbox posts for admin')
    try {
      await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })

      const result = await listInboxPosts({
        boardIds: data.boardIds as BoardId[] | undefined,
        statusIds: data.statusIds as PostStatusId[] | undefined,
        statusSlugs: data.statusSlugs,
        tagIds: data.tagIds as PostTagId[] | undefined,
        segmentIds: data.segmentIds as SegmentId[] | undefined,
        ownerId: data.ownerId as PrincipalId | null | undefined,
        search: data.search,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
        dateTo: data.dateTo ? new Date(data.dateTo) : undefined,
        minVotes: data.minVotes,
        minComments: data.minComments,
        responded: data.responded,
        updatedBefore: data.updatedBefore ? new Date(data.updatedBefore) : undefined,
        sort: data.sort,
        showDeleted: data.showDeleted,
        cursor: data.cursor,
        limit: data.limit,
      })
      log.debug(
        { count: result.items.length, cursor: data.cursor ?? 'none' },
        'fetched inbox posts for admin'
      )
      return {
        ...result,
        items: result.items.map((p) => ({
          ...serializePostDates(p),
          contentJson: (p.contentJson ?? {}) as TiptapContent,
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'fetch inbox posts for admin failed')
      throw error
    }
  })

/**
 * Get a single post with full details including comments
 */
export const fetchPostWithDetails = createServerFn({ method: 'GET' })
  .validator(getPostSchema)
  .handler(async ({ data }) => {
    log.debug({ post_id: data.id }, 'fetch post with details')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })

      const postId = data.id as PostId

      const [result, comments, voted] = await Promise.all([
        getPostWithDetails(postId),
        getCommentsWithReplies(postId, auth.principal.id),
        hasUserVoted(postId, auth.principal.id),
      ])
      log.debug(
        { post_id: data.id, found: !!result, comment_count: comments.length, has_voted: voted },
        'fetched post with details'
      )

      // Serialize Date fields in comments
      type SerializedComment = Omit<(typeof comments)[0], 'createdAt' | 'replies'> & {
        createdAt: string
        replies: SerializedComment[]
      }
      const serializeComment = (comment: (typeof comments)[0]): SerializedComment => ({
        ...comment,
        createdAt: toIsoString(comment.createdAt),
        replies: comment.replies.map(serializeComment),
      })

      // Serialize pinned comment dates
      const serializedPinnedComment = result.pinnedComment
        ? {
            ...result.pinnedComment,
            createdAt: toIsoString(result.pinnedComment.createdAt),
          }
        : null

      // Fetch merge info: merged posts (if canonical) or merge info (if duplicate)
      // The admin handler is team-gated, so the resolved actor is admin
      // or member — both pass canViewPost on any audience. Without the
      // actor though, getPostMergeInfo defaulted to ANONYMOUS_ACTOR and
      // hid the merge banner for canonicals on restricted-audience boards.
      const adminMergeActor = await policyActorFromAuth(auth)
      const [mergedPosts, mergeInfo] = await Promise.all([
        getMergedPosts(postId).then((posts) =>
          posts.map((p) => ({
            ...p,
            createdAt: toIsoString(p.createdAt),
            mergedAt: toIsoString(p.mergedAt),
          }))
        ),
        result.canonicalPostId
          ? getPostMergeInfo(postId, adminMergeActor).then((info) =>
              info ? { ...info, mergedAt: toIsoString(info.mergedAt) } : null
            )
          : null,
      ])

      return {
        ...serializePostDates(result),
        summaryUpdatedAt: toIsoStringOrNull(result.summaryUpdatedAt),
        hasVoted: voted,
        comments: comments.map(serializeComment),
        pinnedComment: serializedPinnedComment,
        canonicalPostId: result.canonicalPostId,
        mergedAt: toIsoStringOrNull(result.mergedAt),
        mergedPosts: mergedPosts.length > 0 ? mergedPosts : undefined,
        mergeInfo,
      }
    } catch (error) {
      log.error({ err: error }, 'fetch post with details failed')
      throw error
    }
  })

/**
 * Get voters for a post (admin/member only)
 */
export const fetchPostVotersFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })
    const voters = await getPostVoters(data.id as PostId)
    return voters.map((v) => ({
      ...v,
      createdAt: toIsoString(v.createdAt as Date | string),
    }))
  })

/**
 * Get feedback source for a post (if created from feedback pipeline)
 */
export const fetchPostFeedbackSourceFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })
    const source = await getPostFeedbackSource(data.id as PostId)
    if (!source) return null
    return {
      ...source,
      createdAt: toIsoString(source.createdAt),
    }
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new post
 */
export const createPostFn = createServerFn({ method: 'POST' })
  .validator(createPostSchema)
  .handler(async ({ data }) => {
    log.info({ board_id: data.boardId }, 'create post')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_CREATE })
      // Caller is always team — the policy gate inside createPost bypasses
      // approval for team via canCreatePost. We still build the actor to
      // pass through so audience checks are correct (e.g. a non-team API
      // path wouldn't get here at all).
      const actor = await policyActorFromAuth(auth)

      // Resolve author: use specified principal or fall back to authenticated user
      let author: {
        principalId: PrincipalId
        userId?: UserId
        name?: string
        email?: string
        actor?: typeof actor
      } = {
        principalId: auth.principal.id,
        userId: auth.user.id as UserId,
        name: auth.user.name,
        email: auth.user.email,
        actor,
      }

      if (
        data.authorPrincipalId &&
        data.authorPrincipalId !== auth.principal.id &&
        can(actor, PERMISSIONS.POST_SET_AUTHOR)
      ) {
        const selectedPrincipal = await getMemberById(data.authorPrincipalId as PrincipalId)
        if (selectedPrincipal) {
          author = {
            principalId: selectedPrincipal.id,
            name: selectedPrincipal.displayName ?? undefined,
            // Keep the actor of the *caller* (the admin), not the override
            // target — policy decisions reflect who's doing the create.
            actor,
          }
        }
      }

      const result = await createPost(
        {
          title: data.title,
          content: data.content,
          contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : undefined,
          boardId: data.boardId as BoardId,
          statusId: data.statusId as PostStatusId | undefined,
          tagIds: data.tagIds as PostTagId[] | undefined,
        },
        author,
        { headers: getRequestHeaders() }
      )
      log.info({ post_id: result.id }, 'post created')

      // Events are now dispatched by the service layer

      return serializePostDates(result)
    } catch (error) {
      log.error({ err: error }, 'create post failed')
      throw error
    }
  })

/**
 * Update an existing post
 */
export const updatePostFn = createServerFn({ method: 'POST' })
  .validator(updatePostSchema)
  .handler(async ({ data }) => {
    log.info({ post_id: data.id }, 'update post')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_EDIT })

      const result = await updatePost(
        data.id as PostId,
        {
          title: data.title,
          content: data.content,
          contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : undefined,
        },
        {
          principalId: auth.principal.id,
          userId: auth.user.id as UserId,
          email: auth.user.email,
          displayName: auth.user.name,
        }
      )
      log.info({ post_id: result.id }, 'post updated')
      return serializePostDates(result)
    } catch (error) {
      log.error({ err: error }, 'update post failed')
      throw error
    }
  })

/**
 * Set a post's owner (assignee). Split out of updatePostFn so the assignee
 * picker gates on the granular post.set_owner rather than the coarse edit path.
 */
export const setPostOwnerFn = createServerFn({ method: 'POST' })
  .validator(setPostOwnerSchema)
  .handler(async ({ data }) => {
    log.info({ post_id: data.id }, 'set post owner')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_SET_OWNER })

      const result = await updatePost(
        data.id as PostId,
        { ownerPrincipalId: data.ownerId as PrincipalId | null },
        {
          principalId: auth.principal.id,
          userId: auth.user.id as UserId,
          email: auth.user.email,
          displayName: auth.user.name,
        }
      )
      log.info({ post_id: result.id }, 'post owner set')
      return serializePostDates(result)
    } catch (error) {
      log.error({ err: error }, 'set post owner failed')
      throw error
    }
  })

/**
 * Set or clear a post ETA (time-based roadmap). First enforcement of the
 * reserved post.set_eta permission.
 */
export const setPostEtaFn = createServerFn({ method: 'POST' })
  .validator(setPostEtaSchema)
  .handler(async ({ data }) => {
    log.info({ post_id: data.id }, 'set post eta')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_SET_ETA })

      const result = await updatePost(
        data.id as PostId,
        { eta: data.eta ? new Date(data.eta) : null },
        {
          principalId: auth.principal.id,
          userId: auth.user.id as UserId,
          email: auth.user.email,
          displayName: auth.user.name,
        }
      )
      log.info({ post_id: result.id }, 'post eta set')
      return serializePostDates(result)
    } catch (error) {
      log.error({ err: error }, 'set post eta failed')
      throw error
    }
  })

/**
 * Delete a post (soft delete) with optional cascade archive/close of linked issues.
 * Note: softDeletePost already dispatches post.deleted — no duplicate dispatch here.
 */
export const deletePostFn = createServerFn({ method: 'POST' })
  .validator(deletePostSchema)
  .handler(async ({ data }) => {
    log.info({ post_id: data.id }, 'delete post')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_DELETE })
      const postId = data.id as PostId

      // Soft delete the post (always succeeds or throws; dispatches post.deleted event)
      await softDeletePost(postId, {
        principalId: auth.principal.id,
        role: auth.principal.role,
        userId: auth.user.id,
      })
      log.info({ post_id: data.id }, 'post deleted')

      // Cascade archive/close linked issues (never blocks post delete)
      let cascadeResults: Array<{
        linkId: string
        integrationType: string
        externalId: string
        success: boolean
        error?: string
      }> = []
      if (data.cascadeChoices && data.cascadeChoices.length > 0) {
        try {
          cascadeResults = await executeCascadeDelete(postId, data.cascadeChoices)
          const failed = cascadeResults.filter((r) => !r.success)
          if (failed.length > 0) {
            log.warn(
              { post_id: data.id, failed_count: failed.length, failed },
              'cascade archive(s) failed'
            )
          }
        } catch (err) {
          log.error({ err }, 'cascade archive error (non-blocking)')
        }
      }

      return { id: data.id, cascadeResults }
    } catch (error) {
      log.error({ err: error }, 'delete post failed')
      throw error
    }
  })

/**
 * Fetch external links for a post (for cascade delete dialog)
 */
export const fetchPostExternalLinksFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    log.debug({ post_id: data.id }, 'fetch post external links')
    try {
      await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })
      const links = await getPostExternalLinks(data.id as PostId)
      log.debug({ count: links.length }, 'fetch post external links result')
      return links
    } catch (error) {
      log.error({ err: error }, 'fetch post external links failed')
      throw error
    }
  })

/**
 * Change post status
 */
export const changePostStatusFn = createServerFn({ method: 'POST' })
  .validator(changeStatusSchema)
  .handler(async ({ data }) => {
    log.info({ post_id: data.id, status_id: data.statusId }, 'change post status')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_SET_STATUS })

      const result = await changeStatus(data.id as PostId, data.statusId as PostStatusId, {
        principalId: auth.principal.id,
        userId: auth.user.id as UserId,
        email: auth.user.email,
      })

      // Events are dispatched by the service layer

      log.info({ post_id: data.id, new_status: result.newStatus }, 'post status changed')
      return serializePostDates(result)
    } catch (error) {
      log.error({ err: error }, 'change post status failed')
      throw error
    }
  })

/**
 * Move a post to a different board
 */
export const changePostBoardFn = createServerFn({ method: 'POST' })
  .validator(changePostBoardSchema)
  .handler(async ({ data }) => {
    log.info({ post_id: data.id, board_id: data.boardId }, 'change post board')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_SET_BOARD })
      const result = await changeBoard(data.id as PostId, data.boardId as BoardId, {
        principalId: auth.principal.id,
        userId: auth.user.id as UserId,
        email: auth.user.email,
        displayName: auth.user.name,
      })
      log.info({ post_id: data.id }, 'post board changed')
      return serializePostDates(result)
    } catch (error) {
      log.error({ err: error }, 'change post board failed')
      throw error
    }
  })

/**
 * Restore a deleted post
 */
export const restorePostFn = createServerFn({ method: 'POST' })
  .validator(restorePostSchema)
  .handler(async ({ data }) => {
    log.info({ post_id: data.id }, 'restore post')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_DELETE })

      const result = await restorePost(data.id as PostId, auth.principal.id, auth.user.id)
      log.info({ post_id: result.id }, 'post restored')
      return serializePostDates(result)
    } catch (error) {
      log.error({ err: error }, 'restore post failed')
      throw error
    }
  })

/**
 * Update post tags
 */
export const updatePostTagsFn = createServerFn({ method: 'POST' })
  .validator(updateTagsSchema)
  .handler(async ({ data }) => {
    log.info({ post_id: data.id, tag_count: data.tagIds.length }, 'update post tags')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_SET_TAGS })

      await updatePost(
        data.id as PostId,
        {
          tagIds: data.tagIds as PostTagId[],
        },
        {
          principalId: auth.principal.id,
          userId: auth.user.id as UserId,
          email: auth.user.email,
          displayName: auth.user.name,
        }
      )
      log.info({ post_id: data.id }, 'post tags updated')
      return { id: data.id }
    } catch (error) {
      log.error({ err: error }, 'update post tags failed')
      throw error
    }
  })

/**
 * Proxy vote: admin votes on behalf of another user
 */
export const proxyVoteFn = createServerFn({ method: 'POST' })
  .validator(z.object({ postId: z.string(), voterPrincipalId: z.string() }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.POST_VOTE_ON_BEHALF })
    const postId = data.postId as PostId
    const voterPrincipalId = data.voterPrincipalId as PrincipalId

    const result = await addVoteOnBehalf(
      postId,
      voterPrincipalId,
      { type: 'proxy', externalUrl: '' },
      null,
      auth.principal.id
    )

    // Fire-and-forget activity if a new vote was actually inserted
    if (result.voted) {
      const voter = await getMemberById(voterPrincipalId)
      createActivity({
        postId,
        principalId: auth.principal.id,
        type: 'vote.proxy',
        metadata: {
          voterPrincipalId,
          voterName: voter?.displayName ?? null,
        },
      })
    }

    return result
  })

/**
 * Remove a vote: admin removes any user's vote from a post
 */
export const removeVoteFn = createServerFn({ method: 'POST' })
  .validator(z.object({ postId: z.string(), voterPrincipalId: z.string() }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.POST_VOTE_ON_BEHALF })
    const postId = data.postId as PostId
    const voterPrincipalId = data.voterPrincipalId as PrincipalId

    const result = await removeVote(postId, voterPrincipalId)

    if (result.removed) {
      const voter = await getMemberById(voterPrincipalId)
      createActivity({
        postId,
        principalId: auth.principal.id,
        type: 'vote.removed',
        metadata: {
          voterPrincipalId,
          voterName: voter?.displayName ?? null,
        },
      })
    }

    return result
  })

/**
 * Toggle comments lock on a post
 */
export const toggleCommentsLockFn = createServerFn({ method: 'POST' })
  .validator(toggleCommentsLockSchema)
  .handler(async ({ data }) => {
    log.info({ post_id: data.id, locked: data.locked }, 'toggle comments lock')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.POST_EDIT })

      await db
        .update(posts)
        .set({ isCommentsLocked: data.locked })
        .where(eq(posts.id, data.id as PostId))

      createActivity({
        postId: data.id as PostId,
        principalId: auth.principal.id,
        type: data.locked ? 'comments.locked' : 'comments.unlocked',
      })

      log.info({ post_id: data.id }, 'comments lock toggled')
      return { id: data.id, isCommentsLocked: data.locked }
    } catch (error) {
      log.error({ err: error }, 'toggle comments lock failed')
      throw error
    }
  })
