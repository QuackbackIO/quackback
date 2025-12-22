'use server'

import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, posts, eq, and } from '@/lib/db'
import { SubscriptionService } from '@quackback/domain/subscriptions'
import {
  postIdSchema,
  type PostId,
  type MemberId,
  type UserId,
} from '@quackback/ids'
import { actionOk, actionErr, type ActionResult } from './types'

// ============================================
// Schemas
// ============================================

const getSubscriptionSchema = z.object({
  postId: postIdSchema,
})

const subscribeSchema = z.object({
  postId: postIdSchema,
  reason: z.enum(['manual', 'author', 'vote', 'comment']).optional().default('manual'),
})

const unsubscribeSchema = z.object({
  postId: postIdSchema,
})

const muteSchema = z.object({
  postId: postIdSchema,
  muted: z.boolean(),
})

// ============================================
// Type Exports
// ============================================

export type GetSubscriptionInput = z.infer<typeof getSubscriptionSchema>
export type SubscribeInput = z.infer<typeof subscribeSchema>
export type UnsubscribeInput = z.infer<typeof unsubscribeSchema>
export type MuteInput = z.infer<typeof muteSchema>

export interface SubscriptionStatus {
  subscribed: boolean
  muted: boolean
  reason: string | null
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get post
 */
async function getPost(postId: PostId) {
  return db.query.posts.findFirst({
    where: eq(posts.id, postId),
  })
}

/**
 * Get member record for a user
 */
async function getMemberRecord(userId: UserId) {
  return db.query.member.findFirst({
    where: eq(member.userId, userId),
  })
}

// ============================================
// Actions
// ============================================

/**
 * Get the current user's subscription status for a post.
 */
export async function getSubscriptionStatusAction(
  rawInput: GetSubscriptionInput
): Promise<ActionResult<SubscriptionStatus>> {
  try {
    const parseResult = getSubscriptionSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const postId = parseResult.data.postId as PostId

    // Require auth
    const session = await getSession()
    if (!session?.user) {
      return actionErr({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        status: 401,
      })
    }

    // Get post
    const post = await getPost(postId)
    if (!post) {
      return actionErr({ code: 'NOT_FOUND', message: 'Post not found', status: 404 })
    }

    // Get member record
    const memberRecord = await getMemberRecord(session.user.id as UserId)
    if (!memberRecord) {
      return actionErr({
        code: 'FORBIDDEN',
        message: 'You must be a member',
        status: 403,
      })
    }

    const subscriptionService = new SubscriptionService()
    const status = await subscriptionService.getSubscriptionStatus(
      memberRecord.id as MemberId,
      postId
    )

    return actionOk(status)
  } catch (error) {
    console.error('Error fetching subscription status:', error)
    return actionErr({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      status: 500,
    })
  }
}

/**
 * Subscribe to a post.
 */
export async function subscribeToPostAction(
  rawInput: SubscribeInput
): Promise<ActionResult<SubscriptionStatus>> {
  try {
    const parseResult = subscribeSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const { postId: postIdRaw, reason } = parseResult.data
    const postId = postIdRaw as PostId

    // Require auth
    const session = await getSession()
    if (!session?.user) {
      return actionErr({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        status: 401,
      })
    }

    // Get post
    const post = await getPost(postId)
    if (!post) {
      return actionErr({ code: 'NOT_FOUND', message: 'Post not found', status: 404 })
    }

    // Get member record
    const memberRecord = await getMemberRecord(session.user.id as UserId)
    if (!memberRecord) {
      return actionErr({
        code: 'FORBIDDEN',
        message: 'You must be a member',
        status: 403,
      })
    }

    const subscriptionService = new SubscriptionService()
    await subscriptionService.subscribeToPost(
      memberRecord.id as MemberId,
      postId,
      reason
    )

    return actionOk({
      subscribed: true,
      muted: false,
      reason,
    })
  } catch (error) {
    console.error('Error subscribing to post:', error)
    return actionErr({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      status: 500,
    })
  }
}

/**
 * Unsubscribe from a post.
 */
export async function unsubscribeFromPostAction(
  rawInput: UnsubscribeInput
): Promise<ActionResult<SubscriptionStatus>> {
  try {
    const parseResult = unsubscribeSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const postId = parseResult.data.postId as PostId

    // Require auth
    const session = await getSession()
    if (!session?.user) {
      return actionErr({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        status: 401,
      })
    }

    // Get post
    const post = await getPost(postId)
    if (!post) {
      return actionErr({ code: 'NOT_FOUND', message: 'Post not found', status: 404 })
    }

    // Get member record
    const memberRecord = await getMemberRecord(session.user.id as UserId)
    if (!memberRecord) {
      return actionErr({
        code: 'FORBIDDEN',
        message: 'You must be a member',
        status: 403,
      })
    }

    const subscriptionService = new SubscriptionService()
    await subscriptionService.unsubscribeFromPost(memberRecord.id as MemberId, postId)

    return actionOk({
      subscribed: false,
      muted: false,
      reason: null,
    })
  } catch (error) {
    console.error('Error unsubscribing from post:', error)
    return actionErr({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      status: 500,
    })
  }
}

/**
 * Update subscription mute status.
 */
export async function muteSubscriptionAction(
  rawInput: MuteInput
): Promise<ActionResult<SubscriptionStatus>> {
  try {
    const parseResult = muteSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const { postId: postIdRaw, muted } = parseResult.data
    const postId = postIdRaw as PostId

    // Require auth
    const session = await getSession()
    if (!session?.user) {
      return actionErr({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        status: 401,
      })
    }

    // Get post
    const post = await getPost(postId)
    if (!post) {
      return actionErr({ code: 'NOT_FOUND', message: 'Post not found', status: 404 })
    }

    // Get member record
    const memberRecord = await getMemberRecord(session.user.id as UserId)
    if (!memberRecord) {
      return actionErr({
        code: 'FORBIDDEN',
        message: 'You must be a member',
        status: 403,
      })
    }

    const subscriptionService = new SubscriptionService()
    const memberId = memberRecord.id as MemberId
    await subscriptionService.setSubscriptionMuted(memberId, postId, muted)

    // Get updated status
    const status = await subscriptionService.getSubscriptionStatus(memberId, postId)

    return actionOk(status)
  } catch (error) {
    console.error('Error updating subscription:', error)
    return actionErr({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      status: 500,
    })
  }
}
