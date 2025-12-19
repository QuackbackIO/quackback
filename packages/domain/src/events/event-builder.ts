/**
 * Event builder utilities for creating EventJobData.
 *
 * These helpers construct the event data structure that API routes
 * pass to jobAdapter.addEventJob().
 *
 * Each builder returns a strongly-typed event job data object that
 * can be used with jobAdapter.addEventJob().
 */

import { randomUUID } from 'crypto'
import type {
  EventActor,
  PostCreatedEventJobData,
  PostStatusChangedEventJobData,
  CommentCreatedEventJobData,
  EventPostData,
  EventPostRef,
  EventCommentData,
} from '@quackback/jobs'
import type { WorkspaceId, PostId, BoardId, CommentId } from '@quackback/ids'

// Re-export EventActor for API routes that need to construct actor objects
export type { EventActor } from '@quackback/jobs'

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
 * @param workspaceId - The organization this event belongs to
 * @param actor - Who triggered the event (user or system)
 * @param post - The created post data
 * @returns Strongly-typed PostCreatedEventJobData
 *
 * @example
 * const event = buildPostCreatedEvent(
 *   ctx.workspaceId,
 *   { type: 'user', userId: ctx.userId, email: ctx.userEmail },
 *   { id: post.id, title: post.title, content: post.content, ... }
 * )
 * await jobAdapter.addEventJob(event)
 */
export function buildPostCreatedEvent(
  workspaceId: WorkspaceId,
  actor: EventActor,
  post: PostCreatedInput
): PostCreatedEventJobData {
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
    workspaceId,
    timestamp: new Date().toISOString(),
    actor,
    data: { post: postData },
  }
}

/**
 * Build event data for post.status_changed event.
 *
 * @param workspaceId - The organization this event belongs to
 * @param actor - Who triggered the event (user or system)
 * @param post - Reference to the post that was updated
 * @param previousStatus - The status name before the change (e.g., "Open")
 * @param newStatus - The status name after the change (e.g., "In Progress")
 * @returns Strongly-typed PostStatusChangedEventJobData
 *
 * @example
 * const event = buildPostStatusChangedEvent(
 *   ctx.workspaceId,
 *   { type: 'user', userId: ctx.userId, email: ctx.userEmail },
 *   { id: post.id, title: post.title, boardSlug },
 *   'Open',
 *   'In Progress'
 * )
 * await jobAdapter.addEventJob(event)
 */
export function buildPostStatusChangedEvent(
  workspaceId: WorkspaceId,
  actor: EventActor,
  post: PostStatusChangedInput,
  previousStatus: string,
  newStatus: string
): PostStatusChangedEventJobData {
  const postRef: EventPostRef = {
    id: post.id,
    title: post.title,
    boardSlug: post.boardSlug,
  }

  return {
    id: randomUUID(),
    type: 'post.status_changed',
    workspaceId,
    timestamp: new Date().toISOString(),
    actor,
    data: { post: postRef, previousStatus, newStatus },
  }
}

/**
 * Build event data for comment.created event.
 *
 * @param workspaceId - The organization this event belongs to
 * @param actor - Who triggered the event (user or system)
 * @param comment - The created comment data
 * @param post - Reference to the post the comment was added to
 * @returns Strongly-typed CommentCreatedEventJobData
 *
 * @example
 * const event = buildCommentCreatedEvent(
 *   ctx.workspaceId,
 *   { type: 'user', userId: ctx.userId, email: ctx.userEmail },
 *   { id: comment.id, content: comment.content, authorEmail: ctx.userEmail },
 *   { id: post.id, title: post.title }
 * )
 * await jobAdapter.addEventJob(event)
 */
export function buildCommentCreatedEvent(
  workspaceId: WorkspaceId,
  actor: EventActor,
  comment: CommentCreatedInput,
  post: CommentPostInput
): CommentCreatedEventJobData {
  const commentData: EventCommentData = {
    id: comment.id,
    content: comment.content,
    authorEmail: comment.authorEmail,
  }

  return {
    id: randomUUID(),
    type: 'comment.created',
    workspaceId,
    timestamp: new Date().toISOString(),
    actor,
    data: {
      comment: commentData,
      post: { id: post.id, title: post.title },
    },
  }
}
