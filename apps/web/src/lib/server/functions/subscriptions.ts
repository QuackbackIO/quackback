/**
 * Server functions for subscription operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type PostId, type PrincipalId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import type { SubscriptionLevel } from '@/lib/server/domains/subscriptions/subscription.service'
import { db, votes, eq, and } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'subscriptions' })

const getSubscriptionStatusSchema = z.object({
  postId: z.string(),
})

const subscribeToPostSchema = z.object({
  postId: z.string(),
  reason: z.enum(['manual', 'author', 'vote', 'comment']).optional().default('manual'),
  level: z.enum(['all', 'status_only']).optional().default('all'),
})

const unsubscribeFromPostSchema = z.object({
  postId: z.string(),
})

const updateSubscriptionLevelSchema = z.object({
  postId: z.string(),
  level: z.enum(['all', 'status_only', 'none']),
})

export type GetSubscriptionStatusInput = z.infer<typeof getSubscriptionStatusSchema>
export type SubscribeToPostInput = z.infer<typeof subscribeToPostSchema>
export type UnsubscribeFromPostInput = z.infer<typeof unsubscribeFromPostSchema>
export type UpdateSubscriptionLevelInput = z.infer<typeof updateSubscriptionLevelSchema>

// Read Operations
export const fetchSubscriptionStatus = createServerFn({ method: 'GET' })
  .inputValidator(getSubscriptionStatusSchema)
  .handler(async ({ data }) => {
    log.debug({ post_id: data.postId }, 'fetch subscription status')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      // Same gate as the write paths below. Without it, an authenticated
      // portal user could probe any postId to confirm existence and
      // learn their prior subscription level on team-only / segment-
      // restricted boards. The round-2 fix patched a same-named
      // function in functions/portal.ts; this is the one the
      // subscription-bell UI actually imports.
      await gateSubscriptionWrite(data.postId as PostId, auth)

      const { getSubscriptionStatus } =
        await import('@/lib/server/domains/subscriptions/subscription.service')
      const result = await getSubscriptionStatus(auth.principal.id, data.postId as PostId)
      log.debug({ level: result.level }, 'subscription status fetched')
      return result
    } catch (error) {
      log.error({ err: error }, 'fetch subscription status failed')
      throw error
    }
  })

// Helper: portal + per-post audience gate shared by all three write paths.
// Without it, an authenticated portal user could subscribe to a team-only
// post by id and start receiving notifications whose body embeds the
// post title and comment previews — a fan-out leak of audience-restricted
// content. Same shape as the gates on createCommentFn / toggleVoteFn.
async function gateSubscriptionWrite(
  postId: PostId,
  auth: Awaited<ReturnType<typeof requireAuth>>
) {
  const { resolvePortalAccessForRequest } = await import('./portal-access')
  const access = await resolvePortalAccessForRequest()
  if (!access.granted) {
    throw new Error('Portal access required')
  }
  const { assertPostViewable } = await import('@/lib/server/domains/posts/post.access')
  const { policyActorFromAuth } = await import('./auth-helpers')
  const actor = await policyActorFromAuth(auth)
  await assertPostViewable(postId, actor)
}

// Write Operations
export const subscribeToPostFn = createServerFn({ method: 'POST' })
  .inputValidator(subscribeToPostSchema)
  .handler(async ({ data }) => {
    log.debug({ post_id: data.postId, level: data.level }, 'subscribe to post')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await gateSubscriptionWrite(data.postId as PostId, auth)

      const { subscribeToPost } =
        await import('@/lib/server/domains/subscriptions/subscription.service')
      await subscribeToPost(auth.principal.id, data.postId as PostId, data.reason || 'manual', {
        level: data.level as SubscriptionLevel,
      })
      log.info({ post_id: data.postId }, 'post subscribed')
      return { postId: data.postId }
    } catch (error) {
      log.error({ err: error }, 'subscribe to post failed')
      throw error
    }
  })

export const unsubscribeFromPostFn = createServerFn({ method: 'POST' })
  .inputValidator(unsubscribeFromPostSchema)
  .handler(async ({ data }) => {
    log.debug({ post_id: data.postId }, 'unsubscribe from post')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await gateSubscriptionWrite(data.postId as PostId, auth)

      const { unsubscribeFromPost } =
        await import('@/lib/server/domains/subscriptions/subscription.service')
      await unsubscribeFromPost(auth.principal.id, data.postId as PostId)
      log.info({ post_id: data.postId }, 'post unsubscribed')
      return { postId: data.postId }
    } catch (error) {
      log.error({ err: error }, 'unsubscribe from post failed')
      throw error
    }
  })

export const updateSubscriptionLevelFn = createServerFn({ method: 'POST' })
  .inputValidator(updateSubscriptionLevelSchema)
  .handler(async ({ data }) => {
    log.debug({ post_id: data.postId, level: data.level }, 'update subscription level')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await gateSubscriptionWrite(data.postId as PostId, auth)

      const { updateSubscriptionLevel } =
        await import('@/lib/server/domains/subscriptions/subscription.service')
      await updateSubscriptionLevel(
        auth.principal.id,
        data.postId as PostId,
        data.level as SubscriptionLevel
      )
      log.info({ post_id: data.postId }, 'subscription level updated')
      return { postId: data.postId }
    } catch (error) {
      log.error({ err: error }, 'update subscription level failed')
      throw error
    }
  })

// Admin mutation: update any voter's subscription level
const adminUpdateVoterSubscriptionSchema = z.object({
  postId: z.string(),
  principalId: z.string(),
  level: z.enum(['all', 'status_only', 'none']),
})

export type AdminUpdateVoterSubscriptionInput = z.infer<typeof adminUpdateVoterSubscriptionSchema>

export const adminUpdateVoterSubscriptionFn = createServerFn({ method: 'POST' })
  .inputValidator(adminUpdateVoterSubscriptionSchema)
  .handler(async ({ data }) => {
    log.debug({ post_id: data.postId, principal_id: data.principalId, level: data.level }, 'admin update voter subscription')
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const targetPrincipalId = data.principalId as PrincipalId
      const targetPostId = data.postId as PostId

      const { unsubscribeFromPost, subscribeToPost, updateSubscriptionLevel } =
        await import('@/lib/server/domains/subscriptions/subscription.service')

      // Verify the principal actually has a vote on this post
      const [vote] = await db
        .select({ id: votes.id })
        .from(votes)
        .where(and(eq(votes.postId, targetPostId), eq(votes.principalId, targetPrincipalId)))
        .limit(1)
      if (!vote) {
        throw new Error('Principal does not have a vote on this post')
      }
      if (data.level === 'none') {
        await unsubscribeFromPost(targetPrincipalId, targetPostId)
      } else {
        // Pass level directly to avoid intermediate over-subscribed state
        await subscribeToPost(targetPrincipalId, targetPostId, 'manual', {
          level: data.level as SubscriptionLevel,
        })
        await updateSubscriptionLevel(
          targetPrincipalId,
          targetPostId,
          data.level as SubscriptionLevel
        )
      }

      log.info({ post_id: data.postId }, 'voter subscription updated')
      return { postId: data.postId, principalId: data.principalId, level: data.level }
    } catch (error) {
      log.error({ err: error }, 'admin update voter subscription failed')
      throw error
    }
  })

// Token-based unsubscribe (no auth required - token is the auth)
const processUnsubscribeTokenSchema = z.object({
  token: z.string().uuid(),
})

export type ProcessUnsubscribeTokenInput = z.infer<typeof processUnsubscribeTokenSchema>

export interface UnsubscribeResult {
  success: boolean
  error?: 'invalid' | 'expired' | 'used' | 'failed'
  action?: string
  postTitle?: string
  boardSlug?: string
  postId?: string
}

export const processUnsubscribeTokenFn = createServerFn({ method: 'POST' })
  .inputValidator(processUnsubscribeTokenSchema)
  .handler(async ({ data }): Promise<UnsubscribeResult> => {
    log.debug('process unsubscribe token')
    try {
      const { processUnsubscribeToken } =
        await import('@/lib/server/domains/subscriptions/subscription.service')
      const result = await processUnsubscribeToken(data.token)

      if (!result) {
        log.debug('unsubscribe token invalid or expired')
        return { success: false, error: 'invalid' }
      }

      log.info({ action: result.action }, 'unsubscribe token processed')
      return {
        success: true,
        action: result.action,
        postTitle: result.post?.title,
        boardSlug: result.post?.boardSlug,
        postId: result.postId ?? undefined,
      }
    } catch (error) {
      log.error({ err: error }, 'process unsubscribe token failed')
      return { success: false, error: 'failed' }
    }
  })
