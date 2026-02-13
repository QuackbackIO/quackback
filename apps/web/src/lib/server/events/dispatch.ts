/**
 * Event dispatching - async event dispatch.
 *
 * processEvent() resolves targets and enqueues hooks (fast, ~10-50ms).
 * Hook execution runs in the background via BullMQ.
 * Errors are caught and logged rather than propagated to the caller.
 */

import { randomUUID } from 'crypto'

import type { BoardId, ChangelogId, CommentId, PostId, PrincipalId, UserId } from '@quackback/ids'

import { processEvent } from './process'
import type { EventActor, EventData } from './types.js'

// Re-export EventActor for API routes that need to construct actor objects
export type { EventActor } from './types.js'

/**
 * Build an EventActor from a principal with optional user details.
 * Constructs a 'user' actor when userId is present, otherwise a 'service' actor.
 */
export function buildEventActor(actor: {
  principalId: PrincipalId
  userId?: UserId
  email?: string
  displayName?: string
}): EventActor {
  if (actor.userId) {
    return {
      type: 'user',
      principalId: actor.principalId,
      userId: actor.userId,
      email: actor.email,
    }
  }
  return { type: 'service', principalId: actor.principalId, displayName: actor.displayName }
}

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
 * Awaiting ensures targets are resolved and jobs enqueued.
 * Hook execution runs in the background via BullMQ.
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

export interface ChangelogPublishedInput {
  id: ChangelogId
  title: string
  contentPreview: string
  publishedAt: Date
  linkedPostCount: number
}

export async function dispatchChangelogPublished(
  actor: EventActor,
  changelog: ChangelogPublishedInput
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'changelog.published',
    data: {
      changelog: {
        id: changelog.id,
        title: changelog.title,
        contentPreview: changelog.contentPreview,
        publishedAt: changelog.publishedAt.toISOString(),
        linkedPostCount: changelog.linkedPostCount,
      },
    },
  })
}
