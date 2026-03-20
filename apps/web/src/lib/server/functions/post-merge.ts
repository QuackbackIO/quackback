/**
 * Server functions for post merge/deduplication operations
 *
 * All operations require admin/member role authentication.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type PostId, type PrincipalId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { toIsoString } from '@/lib/shared/utils'
import {
  mergePost,
  unmergePost,
  getMergedPosts,
  getPostMergeInfo,
  previewMergedPost,
} from '@/lib/server/domains/posts/post.merge'
import { toIsoStringOrNull } from '@/lib/shared/utils'

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
  .inputValidator(mergePostSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:post-merge] mergePostFn: duplicate=${data.duplicatePostId}, canonical=${data.canonicalPostId}`
    )
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      const result = await mergePost(
        data.duplicatePostId as PostId,
        data.canonicalPostId as PostId,
        auth.principal.id as PrincipalId,
        auth.user.id
      )

      console.log(
        `[fn:post-merge] mergePostFn: merged ${data.duplicatePostId} into ${data.canonicalPostId}`
      )
      return result
    } catch (error) {
      console.error(`[fn:post-merge] mergePostFn failed:`, error)
      throw error
    }
  })

/**
 * Unmerge a previously merged post, restoring it to independent state.
 * Requires admin/member role.
 */
export const unmergePostFn = createServerFn({ method: 'POST' })
  .inputValidator(unmergePostSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:post-merge] unmergePostFn: postId=${data.postId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      const result = await unmergePost(data.postId as PostId, auth.principal.id as PrincipalId, auth.user.id)

      console.log(`[fn:post-merge] unmergePostFn: unmerged ${data.postId}`)
      return result
    } catch (error) {
      console.error(`[fn:post-merge] unmergePostFn failed:`, error)
      throw error
    }
  })

/**
 * Get all posts merged into a canonical post.
 * Requires admin/member role.
 */
export const getMergedPostsFn = createServerFn({ method: 'GET' })
  .inputValidator(getMergedPostsSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:post-merge] getMergedPostsFn: canonicalPostId=${data.canonicalPostId}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const result = await getMergedPosts(data.canonicalPostId as PostId)

      console.log(`[fn:post-merge] getMergedPostsFn: found ${result.length} merged posts`)
      return result.map((p) => ({
        ...p,
        createdAt: toIsoString(p.createdAt),
        mergedAt: toIsoString(p.mergedAt),
      }))
    } catch (error) {
      console.error(`[fn:post-merge] getMergedPostsFn failed:`, error)
      throw error
    }
  })

/**
 * Get merge info for a post (if it has been merged into another).
 * No auth required - used for public portal display.
 */
export const getPostMergeInfoFn = createServerFn({ method: 'GET' })
  .inputValidator(getPostMergeInfoSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:post-merge] getPostMergeInfoFn: postId=${data.postId}`)
    try {
      const result = await getPostMergeInfo(data.postId as PostId)

      if (!result) {
        console.log(`[fn:post-merge] getPostMergeInfoFn: not merged`)
        return null
      }

      console.log(`[fn:post-merge] getPostMergeInfoFn: merged into ${result.canonicalPostId}`)
      return {
        ...result,
        mergedAt: toIsoString(result.mergedAt),
      }
    } catch (error) {
      console.error(`[fn:post-merge] getPostMergeInfoFn failed:`, error)
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
  .inputValidator(mergePreviewSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:post-merge] fetchMergePreviewFn: canonical=${data.canonicalPostId}, duplicate=${data.duplicatePostId}`
    )
    try {
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

      console.log(
        `[fn:post-merge] fetchMergePreviewFn: voteCount=${result.post.voteCount}, canonicalComments=${result.post.comments.length}, duplicateComments=${result.duplicateComments.length}`
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
    } catch (error) {
      console.error(`[fn:post-merge] fetchMergePreviewFn failed:`, error)
      throw error
    }
  })
