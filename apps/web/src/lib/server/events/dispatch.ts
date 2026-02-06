/**
 * Event dispatching - async event dispatch with inline building.
 *
 * Events are awaited to ensure hooks complete before the response is sent.
 * Errors are caught and logged rather than propagated to the caller.
 */

import { randomUUID } from 'crypto'

import type { BoardId, CommentId, PostId } from '@quackback/ids'

import { processEvent } from './process'
import type { EventActor, EventData } from './types.js'

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
 * Build common event envelope fields.
 */
function eventEnvelope(actor: EventActor) {
  return { id: randomUUID(), timestamp: new Date().toISOString(), actor } as const
}

/**
 * Dispatch and process an event.
 * Must be awaited to ensure hooks run before the request completes.
 */
async function dispatchEvent(event: EventData): Promise<void> {
  console.log(`[Event] Dispatching ${event.type} event ${event.id}`)
  try {
    await processEvent(event)
  } catch (error) {
    console.error(`[Event] Failed to process ${event.type} event ${event.id}:`, error)
  }
}

export async function dispatchPostCreated(
  actor: EventActor,
  post: PostCreatedInput
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'post.created',
    data: { post },
  })
}

export async function dispatchPostStatusChanged(
  actor: EventActor,
  post: PostStatusChangedInput,
  previousStatus: string,
  newStatus: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'post.status_changed',
    data: { post, previousStatus, newStatus },
  })
}

export async function dispatchCommentCreated(
  actor: EventActor,
  comment: CommentCreatedInput,
  post: CommentPostInput
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'comment.created',
    data: { comment, post },
  })
}
