/**
 * Event dispatching - fire-and-forget event dispatch with inline building.
 *
 * Events are dispatched using a fire-and-forget pattern - errors are logged
 * but don't block the request.
 */

import { randomUUID } from 'crypto'

import type { BoardId, CommentId, PostId } from '@quackback/ids'

import { processEvent } from './process'
import type {
  EventActor,
  EventData,
  PostCreatedEvent,
  PostStatusChangedEvent,
  CommentCreatedEvent,
} from './types.js'

// Re-export EventActor for API routes that need to construct actor objects
export type { EventActor } from './types.js'

export interface PostCreatedInput {
  id: PostId
  title: string
  content: string
  boardId: BoardId
  boardSlug: string
  authorEmail?: string
  authorName?: string
  voteCount: number
}

export interface PostStatusChangedInput {
  id: PostId
  title: string
  boardId: BoardId
  boardSlug: string
}

export interface CommentCreatedInput {
  id: CommentId
  content: string
  authorEmail?: string
  authorName?: string
}

export interface CommentPostInput {
  id: PostId
  title: string
  boardId: BoardId
  boardSlug: string
}

/**
 * Dispatch and process an event.
 * Must be awaited to ensure hooks run before the request completes.
 * (Cloudflare Workers terminate when the response is sent, so fire-and-forget doesn't work.)
 */
async function dispatchEvent(event: EventData): Promise<void> {
  console.log(`[Event] Dispatching ${event.type} event ${event.id}`)
  try {
    await processEvent(event)
  } catch (error) {
    console.error(`[Event] Failed to process ${event.type} event ${event.id}:`, error)
  }
}

/**
 * Dispatch a post.created event.
 */
export async function dispatchPostCreated(
  actor: EventActor,
  post: PostCreatedInput
): Promise<void> {
  const event: PostCreatedEvent = {
    id: randomUUID(),
    type: 'post.created',
    timestamp: new Date().toISOString(),
    actor,
    data: {
      post: {
        id: post.id,
        title: post.title,
        content: post.content,
        boardId: post.boardId,
        boardSlug: post.boardSlug,
        authorEmail: post.authorEmail,
        authorName: post.authorName,
        voteCount: post.voteCount,
      },
    },
  }
  await dispatchEvent(event)
}

/**
 * Dispatch a post.status_changed event.
 */
export async function dispatchPostStatusChanged(
  actor: EventActor,
  post: PostStatusChangedInput,
  previousStatus: string,
  newStatus: string
): Promise<void> {
  const event: PostStatusChangedEvent = {
    id: randomUUID(),
    type: 'post.status_changed',
    timestamp: new Date().toISOString(),
    actor,
    data: {
      post: { id: post.id, title: post.title, boardId: post.boardId, boardSlug: post.boardSlug },
      previousStatus,
      newStatus,
    },
  }
  await dispatchEvent(event)
}

/**
 * Dispatch a comment.created event.
 */
export async function dispatchCommentCreated(
  actor: EventActor,
  comment: CommentCreatedInput,
  post: CommentPostInput
): Promise<void> {
  const event: CommentCreatedEvent = {
    id: randomUUID(),
    type: 'comment.created',
    timestamp: new Date().toISOString(),
    actor,
    data: {
      comment: {
        id: comment.id,
        content: comment.content,
        authorEmail: comment.authorEmail,
        authorName: comment.authorName,
      },
      post: { id: post.id, title: post.title, boardId: post.boardId, boardSlug: post.boardSlug },
    },
  }
  await dispatchEvent(event)
}
