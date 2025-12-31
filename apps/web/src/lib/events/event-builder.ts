/**
 * Event builder utilities for creating EventData.
 *
 * These helpers construct the event data structure that gets dispatched
 * to the event processing system.
 *
 * Each builder returns a strongly-typed event data object that
 * can be used with dispatchEvent().
 */

import { randomUUID } from 'crypto'
import type {
  EventActor,
  PostCreatedEvent,
  PostStatusChangedEvent,
  CommentCreatedEvent,
  EventPostData,
  EventPostRef,
  EventCommentData,
} from './types'
import type { PostId, BoardId, CommentId } from '@quackback/ids'

// Re-export EventActor for API routes that need to construct actor objects
export type { EventActor } from './types'

/**
 * Input type for buildPostCreatedEvent - matches EventPostData but with branded IDs
 */
export interface PostCreatedInput {
  id: PostId
  title: string
  content: string
  boardId: BoardId
  boardSlug: string
  authorEmail?: string
  voteCount: number
}

/**
 * Input type for buildPostStatusChangedEvent - matches EventPostRef but with branded IDs
 */
export interface PostStatusChangedInput {
  id: PostId
  title: string
  boardSlug: string
}

/**
 * Input type for buildCommentCreatedEvent comment - matches EventCommentData but with branded IDs
 */
export interface CommentCreatedInput {
  id: CommentId
  content: string
  authorEmail?: string
}

/**
 * Input type for buildCommentCreatedEvent post reference
 */
export interface CommentPostInput {
  id: PostId
  title: string
}

/**
 * Build event data for post.created event.
 *
 * @param actor - Who triggered the event (user or system)
 * @param post - The created post data
 * @returns Strongly-typed PostCreatedEvent
 *
 * @example
 * const event = buildPostCreatedEvent(
 *   { type: 'user', userId: ctx.userId, email: ctx.userEmail },
 *   { id: post.id, title: post.title, content: post.content, ... }
 * )
 * dispatchPostCreated(actor, post)
 */
export function buildPostCreatedEvent(actor: EventActor, post: PostCreatedInput): PostCreatedEvent {
  const postData: EventPostData = {
    id: post.id,
    title: post.title,
    content: post.content,
    boardId: post.boardId,
    boardSlug: post.boardSlug,
    authorEmail: post.authorEmail,
    voteCount: post.voteCount,
  }

  return {
    id: randomUUID(),
    type: 'post.created',
    timestamp: new Date().toISOString(),
    actor,
    data: { post: postData },
  }
}

/**
 * Build event data for post.status_changed event.
 *
 * @param actor - Who triggered the event (user or system)
 * @param post - Reference to the post that was updated
 * @param previousStatus - The status name before the change (e.g., "Open")
 * @param newStatus - The status name after the change (e.g., "In Progress")
 * @returns Strongly-typed PostStatusChangedEvent
 *
 * @example
 * const event = buildPostStatusChangedEvent(
 *   { type: 'user', userId: ctx.userId, email: ctx.userEmail },
 *   { id: post.id, title: post.title, boardSlug },
 *   'Open',
 *   'In Progress'
 * )
 * dispatchPostStatusChanged(actor, post, 'Open', 'In Progress')
 */
export function buildPostStatusChangedEvent(
  actor: EventActor,
  post: PostStatusChangedInput,
  previousStatus: string,
  newStatus: string
): PostStatusChangedEvent {
  const postRef: EventPostRef = {
    id: post.id,
    title: post.title,
    boardSlug: post.boardSlug,
  }

  return {
    id: randomUUID(),
    type: 'post.status_changed',
    timestamp: new Date().toISOString(),
    actor,
    data: { post: postRef, previousStatus, newStatus },
  }
}

/**
 * Build event data for comment.created event.
 *
 * @param actor - Who triggered the event (user or system)
 * @param comment - The created comment data
 * @param post - Reference to the post the comment was added to
 * @returns Strongly-typed CommentCreatedEvent
 *
 * @example
 * const event = buildCommentCreatedEvent(
 *   { type: 'user', userId: ctx.userId, email: ctx.userEmail },
 *   { id: comment.id, content: comment.content, authorEmail: ctx.userEmail },
 *   { id: post.id, title: post.title }
 * )
 * dispatchCommentCreated(actor, comment, post)
 */
export function buildCommentCreatedEvent(
  actor: EventActor,
  comment: CommentCreatedInput,
  post: CommentPostInput
): CommentCreatedEvent {
  const commentData: EventCommentData = {
    id: comment.id,
    content: comment.content,
    authorEmail: comment.authorEmail,
  }

  return {
    id: randomUUID(),
    type: 'comment.created',
    timestamp: new Date().toISOString(),
    actor,
    data: {
      comment: commentData,
      post: { id: post.id, title: post.title },
    },
  }
}
