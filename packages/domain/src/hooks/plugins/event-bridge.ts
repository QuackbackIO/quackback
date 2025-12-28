/**
 * Event Bridge Plugin
 *
 * Provides backward compatibility by converting hook actions into event jobs.
 * This allows existing integrations (Slack, Webhooks, etc.) to continue working
 * while the hook system is being adopted.
 *
 * The event bridge runs at CRITICAL priority to ensure events are queued before
 * any other action hooks execute.
 */

import type { HookPlugin } from '../plugin'
import type { HookRegistry } from '../registry'
import { PRIORITY } from '../types'
import { HOOKS } from '../hooks'
import {
  buildPostCreatedEvent,
  buildPostStatusChangedEvent,
  buildCommentCreatedEvent,
} from '../../events/event-builder'
import type { EventActor } from '../../events/event-builder'
import type { Post } from '@quackback/db'
import type { WorkspaceId } from '@quackback/ids'

/**
 * Get the workspace ID from settings (single-tenant mode)
 * Returns the first settings record ID which serves as the workspace ID
 */
async function getWorkspaceId(): Promise<WorkspaceId> {
  const { db } = await import('@quackback/db')
  const settings = await db.query.settings.findFirst({
    columns: { id: true },
  })

  if (!settings) {
    throw new Error('Settings not found - workspace ID unavailable')
  }

  return settings.id
}

/**
 * Lazy-loaded job adapter to avoid circular dependencies
 */
async function getJobAdapter() {
  const { getJobAdapter } = await import('@quackback/jobs')
  return getJobAdapter()
}

/**
 * Event Bridge Plugin
 *
 * Converts hook action calls into event jobs for backward compatibility
 * with existing integration system.
 */
export class EventBridgePlugin implements HookPlugin {
  readonly id = 'event-bridge'
  readonly name = 'Event Bridge'
  readonly description = 'Converts hook actions to event jobs for backward compatibility'
  readonly version = '1.0.0'

  /**
   * Register event bridge hooks
   *
   * Converts post and comment actions into event jobs that get processed
   * by the existing integration system (Slack, Webhooks, etc.)
   */
  register(registry: HookRegistry): void {
    // Post created -> post.created event
    registry.addAction(
      HOOKS.POST_AFTER_CREATE,
      async (data, ctx) => {
        try {
          const workspaceId = await getWorkspaceId()
          const jobAdapter = await getJobAdapter()

          // Build actor from service context
          const actor: EventActor = {
            type: 'user',
            userId: ctx.service.userId,
            email: ctx.service.userEmail,
          }

          // Build and queue event
          const event = buildPostCreatedEvent(workspaceId, actor, {
            id: data.id,
            title: data.title,
            content: data.content,
            boardId: data.boardId,
            boardSlug: data.boardSlug,
            authorEmail: data.authorEmail,
            voteCount: data.voteCount,
          })

          await jobAdapter.addEventJob(event)
        } catch (error) {
          // Log but don't throw - event bridge failures shouldn't block post creation
          console.error('[EventBridge] Failed to queue post.created event:', error)
        }
      },
      PRIORITY.CRITICAL, // Run first to ensure events are queued
      `${this.id}:post-created`
    )

    // Post status changed -> post.status_changed event
    registry.addAction(
      HOOKS.POST_AFTER_STATUS_CHANGE,
      async (data, ctx) => {
        try {
          const workspaceId = await getWorkspaceId()
          const jobAdapter = await getJobAdapter()

          const actor: EventActor = {
            type: 'user',
            userId: ctx.service.userId,
            email: ctx.service.userEmail,
          }

          // Extract status info from metadata (set by PostService)
          const previousStatus = (ctx.metadata?.previousStatus as string) || 'Unknown'
          const newStatus = (ctx.metadata?.newStatus as string) || 'Unknown'

          const event = buildPostStatusChangedEvent(
            workspaceId,
            actor,
            {
              id: data.id,
              title: data.title,
              boardSlug: data.boardSlug || '',
            },
            previousStatus,
            newStatus
          )

          await jobAdapter.addEventJob(event)
        } catch (error) {
          console.error('[EventBridge] Failed to queue post.status_changed event:', error)
        }
      },
      PRIORITY.CRITICAL,
      `${this.id}:post-status-changed`
    )

    // Comment created -> comment.created event
    registry.addAction(
      HOOKS.COMMENT_AFTER_CREATE,
      async (data, ctx) => {
        try {
          const workspaceId = await getWorkspaceId()
          const jobAdapter = await getJobAdapter()

          const actor: EventActor = {
            type: 'user',
            userId: ctx.service.userId,
            email: ctx.service.userEmail,
          }

          // Extract post info from metadata (set by CommentService)
          const postId = ctx.metadata?.postId as any
          const postTitle = (ctx.metadata?.postTitle as string) || 'Untitled'

          const event = buildCommentCreatedEvent(
            workspaceId,
            actor,
            {
              id: data.id,
              content: data.content,
              authorEmail: data.authorEmail,
            },
            {
              id: postId,
              title: postTitle,
            }
          )

          await jobAdapter.addEventJob(event)
        } catch (error) {
          console.error('[EventBridge] Failed to queue comment.created event:', error)
        }
      },
      PRIORITY.CRITICAL,
      `${this.id}:comment-created`
    )
  }

  /**
   * Unregister event bridge hooks
   */
  unregister(registry: HookRegistry): void {
    registry.removeAction(HOOKS.POST_AFTER_CREATE, `${this.id}:post-created`)
    registry.removeAction(HOOKS.POST_AFTER_STATUS_CHANGE, `${this.id}:post-status-changed`)
    registry.removeAction(HOOKS.COMMENT_AFTER_CREATE, `${this.id}:comment-created`)
  }
}

/**
 * Global singleton instance of the event bridge plugin
 */
export const eventBridgePlugin = new EventBridgePlugin()
