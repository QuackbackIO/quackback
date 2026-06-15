/**
 * Server functions for post merge/deduplication operations
 *
 * All operations require admin/member role authentication.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type PostId, type PrincipalId } from '@quackback/ids'
import { requireAuth, getOptionalAuth, policyActorFromAuth } from './auth-helpers'
import { toIsoString } from '@/lib/shared/utils'
import {
  mergePost,
  unmergePost,
  getMergedPosts,
  getPostMergeInfo,
  previewMergedPost,
} from '@/lib/server/domains/posts/post.merge'
import { toIsoStringOrNull } from '@/lib/shared/utils'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'post-merge' })

// ============================================
// Schemas
// ============================================

const mergePostSchema = z.object({
  duplicatePostId: z.string(),
  canonicalPostId: z.string(),
})

const unmergePostSchema = z.object({
  postId: z.string(),
})

const getMergedPostsSchema = z.object({
  canonicalPostId: z.string(),
})

const getPostMergeInfoSchema = z.object({
  postId: z.string(),
})

const mergePreviewSchema = z.object({
  canonicalPostId: z.string(),
  duplicatePostId: z.string(),
})

// ============================================
// Type Exports
// ============================================

export type MergePostInput = z.infer<typeof mergePostSchema>
export type UnmergePostInput = z.infer<typeof unmergePostSchema>
export type GetMergedPostsInput = z.infer<typeof getMergedPostsSchema>
export type GetPostMergeInfoInput = z.infer<typeof getPostMergeInfoSchema>

// ============================================
// Server Functions
// ============================================

/**
 * Merge a duplicate post into a canonical post.
 * Requires admin/member role.
 */
export const mergePostFn = createServerFn({ method: 'POST' })
  .validator(mergePostSchema)
  .handler(async ({ data }) => {
    log.debug(
      { duplicate_post_id: data.duplicatePostId, canonical_post_id: data.canonicalPostId },
      'merge post'
    )
    const auth = await requireAuth({ roles: ['admin', 'member'] })

    const result = await mergePost(
      data.duplicatePostId as PostId,
      data.canonicalPostId as PostId,
      auth.principal.id as PrincipalId,
      auth.user.id
    )

    log.info(
      { duplicate_post_id: data.duplicatePostId, canonical_post_id: data.canonicalPostId },
      'post merged'
    )
    return result
  })

/**
 * Unmerge a previously merged post, restoring it to independent state.
 * Requires admin/member role.
 */
export const unmergePostFn = createServerFn({ method: 'POST' })
  .validator(unmergePostSchema)
  .handler(async ({ data }) => {
    log.debug({ post_id: data.postId }, 'unmerge post')
    const auth = await requireAuth({ roles: ['admin', 'member'] })

    const result = await unmergePost(
      data.postId as PostId,
      auth.principal.id as PrincipalId,
      auth.user.id
    )

    log.info({ post_id: data.postId }, 'post unmerged')
    return result
  })

/**
 * Get all posts merged into a canonical post.
 * Requires admin/member role.
 */
export const getMergedPostsFn = createServerFn({ method: 'GET' })
  .validator(getMergedPostsSchema)
  .handler(async ({ data }) => {
    log.debug({ canonical_post_id: data.canonicalPostId }, 'get merged posts')
    await requireAuth({ roles: ['admin', 'member'] })

    const result = await getMergedPosts(data.canonicalPostId as PostId)

    log.debug(
      { canonical_post_id: data.canonicalPostId, count: result.length },
      'found merged posts'
    )
    return result.map((p) => ({
      ...p,
      createdAt: toIsoString(p.createdAt),
      mergedAt: toIsoString(p.mergedAt),
    }))
  })

/**
 * Get merge info for a post (if it has been merged into another).
 *
 * Used by the public portal post-detail view. No login required, but the
 * caller's actor (anonymous when unauthenticated) drives an internal
 * `canViewBoard` check on the canonical's board — a duplicate's caller
 * who isn't entitled to see the canonical's board gets `null`, matching
 * the "doesn't exist" shape used elsewhere to avoid leaking existence.
 */
export const getPostMergeInfoFn = createServerFn({ method: 'GET' })
  .validator(getPostMergeInfoSchema)
  .handler(async ({ data }) => {
    log.debug({ post_id: data.postId }, 'get post merge info')
    try {
      const auth = await getOptionalAuth()
      const actor = await policyActorFromAuth(auth)
      const result = await getPostMergeInfo(data.postId as PostId, actor)

      if (!result) {
        log.debug({ post_id: data.postId }, 'post not merged or audience-denied')
        return null
      }

      log.debug(
        { post_id: data.postId, canonical_post_id: result.canonicalPostId },
        'post merged into canonical'
      )
      return {
        ...result,
        mergedAt: toIsoString(result.mergedAt),
      }
    } catch (error) {
      log.error({ err: error }, 'get post merge info failed')
      return null
    }
  })

/**
 * Preview what a merged post would look like without actually merging.
 * Loads full details for both posts, computes deduplicated vote count,
 * and returns separate comment arrays.
 * Requires admin/member role.
 */
export const fetchMergePreviewFn = createServerFn({ method: 'GET' })
  .validator(mergePreviewSchema)
  .handler(async ({ data }) => {
    log.debug(
      { canonical_post_id: data.canonicalPostId, duplicate_post_id: data.duplicatePostId },
      'fetch merge preview'
    )
    const auth = await requireAuth({ roles: ['admin', 'member'] })

    const result = await previewMergedPost(
      data.canonicalPostId as PostId,
      data.duplicatePostId as PostId,
      auth.principal.id
    )

    // Serialize dates for transport (matching fetchPostWithDetails pattern)
    type RawComment = (typeof result.post.comments)[0]
    type SerializedComment = Omit<RawComment, 'createdAt' | 'replies'> & {
      createdAt: string
      replies: SerializedComment[]
    }
    const serializeComment = (c: RawComment): SerializedComment => ({
      ...c,
      createdAt: toIsoString(c.createdAt),
      replies: c.replies.map(serializeComment),
    })

    const serializedPinnedComment = result.post.pinnedComment
      ? {
          ...result.post.pinnedComment,
          createdAt: toIsoString(result.post.pinnedComment.createdAt),
        }
      : null

    log.debug(
      {
        vote_count: result.post.voteCount,
        canonical_comments: result.post.comments.length,
        duplicate_comments: result.duplicateComments.length,
      },
      'merge preview fetched'
    )

    return {
      post: {
        ...result.post,
        createdAt: toIsoString(result.post.createdAt),
        updatedAt: toIsoString(result.post.updatedAt),
        deletedAt: toIsoStringOrNull(result.post.deletedAt),
        summaryUpdatedAt: toIsoStringOrNull(result.post.summaryUpdatedAt),
        comments: result.post.comments.map(serializeComment),
        pinnedComment: serializedPinnedComment,
      },
      duplicateComments: result.duplicateComments.map(serializeComment),
      duplicatePostTitle: result.duplicatePostTitle,
    }
  })
