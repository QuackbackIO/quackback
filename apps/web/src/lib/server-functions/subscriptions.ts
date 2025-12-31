/**
 * Server functions for subscription operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import {
  getSubscriptionStatus,
  subscribeToPost,
  unsubscribeFromPost,
  setSubscriptionMuted,
} from '@/lib/subscriptions'
import { type PostId } from '@quackback/ids'

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
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member', 'user'] })

    return await getSubscriptionStatus(auth.member.id, data.postId as PostId)
  })

// Write Operations
export const subscribeToPostFn = createServerFn({ method: 'POST' })
  .inputValidator(subscribeToPostSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member', 'user'] })

    await subscribeToPost(auth.member.id, data.postId as PostId, data.reason || 'manual')
    return { postId: data.postId }
  })

export const unsubscribeFromPostFn = createServerFn({ method: 'POST' })
  .inputValidator(unsubscribeFromPostSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member', 'user'] })

    await unsubscribeFromPost(auth.member.id, data.postId as PostId)
    return { postId: data.postId }
  })

export const muteSubscriptionFn = createServerFn({ method: 'POST' })
  .inputValidator(muteSubscriptionSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member', 'user'] })

    await setSubscriptionMuted(auth.member.id, data.postId as PostId, data.muted ?? true)
    return { postId: data.postId }
  })
