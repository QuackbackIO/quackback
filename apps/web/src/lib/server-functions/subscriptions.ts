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
  setSubscriptionMuted,
} from '@/lib/subscriptions/subscription.service'

const getSubscriptionStatusSchema = z.object({
  postId: z.string(),
})

const subscribeToPostSchema = z.object({
  postId: z.string(),
  reason: z.enum(['manual', 'author', 'vote', 'comment']).optional().default('manual'),
})

const unsubscribeFromPostSchema = z.object({
  postId: z.string(),
})

const muteSubscriptionSchema = z.object({
  postId: z.string(),
  muted: z.boolean().optional().default(true),
})

export type GetSubscriptionStatusInput = z.infer<typeof getSubscriptionStatusSchema>
export type SubscribeToPostInput = z.infer<typeof subscribeToPostSchema>
export type UnsubscribeFromPostInput = z.infer<typeof unsubscribeFromPostSchema>
export type MuteSubscriptionInput = z.infer<typeof muteSubscriptionSchema>

// Read Operations
export const fetchSubscriptionStatus = createServerFn({ method: 'GET' })
  .inputValidator(getSubscriptionStatusSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:subscriptions] fetchSubscriptionStatus: postId=${data.postId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

      const result = await getSubscriptionStatus(auth.member.id, data.postId as PostId)
      console.log(`[fn:subscriptions] fetchSubscriptionStatus: subscribed=${result.subscribed}`)
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
    console.log(`[fn:subscriptions] subscribeToPostFn: postId=${data.postId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

      await subscribeToPost(auth.member.id, data.postId as PostId, data.reason || 'manual')
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

export const muteSubscriptionFn = createServerFn({ method: 'POST' })
  .inputValidator(muteSubscriptionSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:subscriptions] muteSubscriptionFn: postId=${data.postId}, muted=${data.muted}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

      await setSubscriptionMuted(auth.member.id, data.postId as PostId, data.muted ?? true)
      console.log(`[fn:subscriptions] muteSubscriptionFn: updated`)
      return { postId: data.postId }
    } catch (error) {
      console.error(`[fn:subscriptions] ❌ muteSubscriptionFn failed:`, error)
      throw error
    }
  })
