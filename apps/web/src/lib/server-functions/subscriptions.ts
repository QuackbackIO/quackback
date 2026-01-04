/**
 * Server functions for subscription operations
 *
 * NOTE: All service imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
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
    const { requireAuth } = await import('./auth-helpers')
    const { getSubscriptionStatus } = await import('@/lib/subscriptions/subscription.service')

    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

    return await getSubscriptionStatus(auth.member.id, data.postId as PostId)
  })

// Write Operations
export const subscribeToPostFn = createServerFn({ method: 'POST' })
  .inputValidator(subscribeToPostSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { subscribeToPost } = await import('@/lib/subscriptions/subscription.service')

    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

    await subscribeToPost(auth.member.id, data.postId as PostId, data.reason || 'manual')
    return { postId: data.postId }
  })

export const unsubscribeFromPostFn = createServerFn({ method: 'POST' })
  .inputValidator(unsubscribeFromPostSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { unsubscribeFromPost } = await import('@/lib/subscriptions/subscription.service')

    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

    await unsubscribeFromPost(auth.member.id, data.postId as PostId)
    return { postId: data.postId }
  })

export const muteSubscriptionFn = createServerFn({ method: 'POST' })
  .inputValidator(muteSubscriptionSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { setSubscriptionMuted } = await import('@/lib/subscriptions/subscription.service')

    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

    await setSubscriptionMuted(auth.member.id, data.postId as PostId, data.muted ?? true)
    return { postId: data.postId }
  })
