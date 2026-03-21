/**
 * Server functions for subscription operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type PostId, type PrincipalId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import {
  getSubscriptionStatus,
  subscribeToPost,
  unsubscribeFromPost,
  updateSubscriptionLevel,
  processUnsubscribeToken,
  type SubscriptionLevel,
} from '@/lib/server/domains/subscriptions/subscription.service'
import { db, votes, eq, and } from '@/lib/server/db'

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
    console.log(`[fn:subscriptions] fetchSubscriptionStatus: postId=${data.postId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

      const result = await getSubscriptionStatus(auth.principal.id, data.postId as PostId)
      console.log(`[fn:subscriptions] fetchSubscriptionStatus: level=${result.level}`)
      return result
    } catch (error) {
      console.error(`[fn:subscriptions] ❌ fetchSubscriptionStatus failed:`, error)
      throw error
    }
  })

// Write Operations
export const subscribeToPostFn = createServerFn({ method: 'POST' })
  .inputValidator(subscribeToPostSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:subscriptions] subscribeToPostFn: postId=${data.postId}, level=${data.level}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

      await subscribeToPost(auth.principal.id, data.postId as PostId, data.reason || 'manual', {
        level: data.level as SubscriptionLevel,
      })
      console.log(`[fn:subscriptions] subscribeToPostFn: subscribed`)
      return { postId: data.postId }
    } catch (error) {
      console.error(`[fn:subscriptions] ❌ subscribeToPostFn failed:`, error)
      throw error
    }
  })

export const unsubscribeFromPostFn = createServerFn({ method: 'POST' })
  .inputValidator(unsubscribeFromPostSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:subscriptions] unsubscribeFromPostFn: postId=${data.postId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

      await unsubscribeFromPost(auth.principal.id, data.postId as PostId)
      console.log(`[fn:subscriptions] unsubscribeFromPostFn: unsubscribed`)
      return { postId: data.postId }
    } catch (error) {
      console.error(`[fn:subscriptions] ❌ unsubscribeFromPostFn failed:`, error)
      throw error
    }
  })

export const updateSubscriptionLevelFn = createServerFn({ method: 'POST' })
  .inputValidator(updateSubscriptionLevelSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:subscriptions] updateSubscriptionLevelFn: postId=${data.postId}, level=${data.level}`
    )
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

      await updateSubscriptionLevel(
        auth.principal.id,
        data.postId as PostId,
        data.level as SubscriptionLevel
      )
      console.log(`[fn:subscriptions] updateSubscriptionLevelFn: updated`)
      return { postId: data.postId }
    } catch (error) {
      console.error(`[fn:subscriptions] ❌ updateSubscriptionLevelFn failed:`, error)
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
    console.log(
      `[fn:subscriptions] adminUpdateVoterSubscriptionFn: postId=${data.postId} principalId=${data.principalId} level=${data.level}`
    )
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const targetPrincipalId = data.principalId as PrincipalId
      const targetPostId = data.postId as PostId

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

      console.log(`[fn:subscriptions] adminUpdateVoterSubscriptionFn: updated`)
      return { postId: data.postId, principalId: data.principalId, level: data.level }
    } catch (error) {
      console.error(`[fn:subscriptions] ❌ adminUpdateVoterSubscriptionFn failed:`, error)
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
    console.log(`[fn:subscriptions] processUnsubscribeTokenFn: token=${data.token.slice(0, 8)}...`)
    try {
      const result = await processUnsubscribeToken(data.token)

      if (!result) {
        console.log(`[fn:subscriptions] processUnsubscribeTokenFn: invalid/expired/used token`)
        return { success: false, error: 'invalid' }
      }

      console.log(`[fn:subscriptions] processUnsubscribeTokenFn: action=${result.action}`)
      return {
        success: true,
        action: result.action,
        postTitle: result.post?.title,
        boardSlug: result.post?.boardSlug,
        postId: result.postId ?? undefined,
      }
    } catch (error) {
      console.error(`[fn:subscriptions] ❌ processUnsubscribeTokenFn failed:`, error)
      return { success: false, error: 'failed' }
    }
  })
