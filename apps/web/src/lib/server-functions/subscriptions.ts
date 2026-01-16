/**
 * Server functions for subscription operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type PostId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import {
  getSubscriptionStatus,
  subscribeToPost,
  unsubscribeFromPost,
  updateSubscriptionLevel,
  processUnsubscribeToken,
  type SubscriptionLevel,
} from '@/lib/subscriptions/subscription.service'

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

      const result = await getSubscriptionStatus(auth.member.id, data.postId as PostId)
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

      await subscribeToPost(auth.member.id, data.postId as PostId, data.reason || 'manual', {
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

      await unsubscribeFromPost(auth.member.id, data.postId as PostId)
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
        auth.member.id,
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
