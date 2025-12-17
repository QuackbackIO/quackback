/**
 * Event builder utilities for creating EventJobData.
 *
 * These helpers construct the event data structure that API routes
 * pass to jobAdapter.addEventJob().
 */

import { randomUUID } from 'crypto'
import type { EventJobData } from '@quackback/jobs'
import type { OrgId, PostId, BoardId, CommentId } from '@quackback/ids'

/**
 * Actor information for events
 */
export interface EventActor {
  type: 'user' | 'system'
  userId?: string
  email?: string
  service?: string
}

/**
 * Build event data for post.created event
 */
export function buildPostCreatedEvent(
  organizationId: OrgId,
  actor: EventActor,
  post: {
    id: PostId
    title: string
    content: string
    boardId: BoardId
    boardSlug: string
    authorEmail?: string
    voteCount: number
  }
): EventJobData {
  return {
    id: randomUUID(),
    type: 'post.created',
    organizationId,
    timestamp: new Date().toISOString(),
    actor,
    data: { post },
  }
}

/**
 * Build event data for post.status_changed event
 */
export function buildPostStatusChangedEvent(
  organizationId: OrgId,
  actor: EventActor,
  post: {
    id: PostId
    title: string
    boardSlug: string
  },
  previousStatus: string,
  newStatus: string
): EventJobData {
  return {
    id: randomUUID(),
    type: 'post.status_changed',
    organizationId,
    timestamp: new Date().toISOString(),
    actor,
    data: { post, previousStatus, newStatus },
  }
}

/**
 * Build event data for comment.created event
 */
export function buildCommentCreatedEvent(
  organizationId: OrgId,
  actor: EventActor,
  comment: {
    id: CommentId
    content: string
    authorEmail?: string
  },
  post: {
    id: PostId
    title: string
  }
): EventJobData {
  return {
    id: randomUUID(),
    type: 'comment.created',
    organizationId,
    timestamp: new Date().toISOString(),
    actor,
    data: { comment, post },
  }
}
