/**
 * Analytics Plugin
 *
 * Example plugin that tracks domain events for analytics purposes.
 * This demonstrates how to use action hooks for fire-and-forget operations
 * like analytics tracking, logging, or metrics collection.
 */

import type { HookPlugin } from '../plugin'
import type { HookRegistry } from '../registry'
import { PRIORITY } from '../types'
import { HOOKS } from '../hooks'

/**
 * Analytics tracking interface
 * In production, this would integrate with your analytics service
 * (e.g., Mixpanel, Segment, PostHog, etc.)
 */
interface AnalyticsEvent {
  type: string
  userId: string
  properties: Record<string, unknown>
  timestamp: Date
}

/**
 * Example analytics client (stub)
 * Replace with actual analytics service integration
 */
class AnalyticsClient {
  async track(event: AnalyticsEvent): Promise<void> {
    // In production, this would send to your analytics service
    console.log('[Analytics] Track event:', event)
  }
}

const analyticsClient = new AnalyticsClient()

/**
 * Analytics Plugin
 *
 * Tracks post creation, status changes, comments, and votes for analytics
 */
export class AnalyticsPlugin implements HookPlugin {
  readonly id = 'analytics'
  readonly name = 'Analytics Tracking'
  readonly description = 'Tracks domain events for analytics and metrics'
  readonly version = '1.0.0'

  register(registry: HookRegistry): void {
    // Track post creation
    registry.addAction(
      HOOKS.POST_AFTER_CREATE,
      async (post, ctx) => {
        await analyticsClient.track({
          type: 'post_created',
          userId: ctx.service.userId,
          properties: {
            postId: post.id,
            boardId: post.boardId,
            titleLength: post.title.length,
            contentLength: post.content.length,
            hasJsonContent: !!post.contentJson,
            memberRole: ctx.service.memberRole,
          },
          timestamp: new Date(),
        })
      },
      PRIORITY.LOW, // Analytics runs after critical operations
      `${this.id}:post-created`
    )

    // Track post status changes
    registry.addAction(
      HOOKS.POST_AFTER_STATUS_CHANGE,
      async (post, ctx) => {
        await analyticsClient.track({
          type: 'post_status_changed',
          userId: ctx.service.userId,
          properties: {
            postId: post.id,
            previousStatus: ctx.metadata?.previousStatus,
            newStatus: ctx.metadata?.newStatus,
            memberRole: ctx.service.memberRole,
          },
          timestamp: new Date(),
        })
      },
      PRIORITY.LOW,
      `${this.id}:post-status-changed`
    )

    // Track comment creation
    registry.addAction(
      HOOKS.COMMENT_AFTER_CREATE,
      async (comment, ctx) => {
        await analyticsClient.track({
          type: 'comment_created',
          userId: ctx.service.userId,
          properties: {
            commentId: comment.id,
            postId: comment.postId,
            contentLength: comment.content.length,
            isReply: !!comment.parentId,
            memberRole: ctx.service.memberRole,
          },
          timestamp: new Date(),
        })
      },
      PRIORITY.LOW,
      `${this.id}:comment-created`
    )

    // Track vote creation
    registry.addAction(
      HOOKS.VOTE_AFTER_CREATE,
      async (vote, ctx) => {
        await analyticsClient.track({
          type: 'vote_created',
          userId: ctx.service.userId,
          properties: {
            postId: vote.postId,
            memberRole: ctx.service.memberRole,
          },
          timestamp: new Date(),
        })
      },
      PRIORITY.LOW,
      `${this.id}:vote-created`
    )

    // Track board creation
    registry.addAction(
      HOOKS.BOARD_AFTER_CREATE,
      async (board, ctx) => {
        await analyticsClient.track({
          type: 'board_created',
          userId: ctx.service.userId,
          properties: {
            boardId: board.id,
            boardSlug: board.slug,
            memberRole: ctx.service.memberRole,
          },
          timestamp: new Date(),
        })
      },
      PRIORITY.LOW,
      `${this.id}:board-created`
    )
  }

  unregister(registry: HookRegistry): void {
    registry.removeAction(HOOKS.POST_AFTER_CREATE, `${this.id}:post-created`)
    registry.removeAction(HOOKS.POST_AFTER_STATUS_CHANGE, `${this.id}:post-status-changed`)
    registry.removeAction(HOOKS.COMMENT_AFTER_CREATE, `${this.id}:comment-created`)
    registry.removeAction(HOOKS.VOTE_AFTER_CREATE, `${this.id}:vote-created`)
    registry.removeAction(HOOKS.BOARD_AFTER_CREATE, `${this.id}:board-created`)
  }
}

/**
 * Global singleton instance
 */
export const analyticsPlugin = new AnalyticsPlugin()
