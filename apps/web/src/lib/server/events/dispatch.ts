/**
 * Event dispatching - async event dispatch.
 *
 * processEvent() resolves targets and enqueues hooks (fast, ~10-50ms).
 * Hook execution runs in the background via BullMQ.
 * Errors are caught and logged rather than propagated to the caller.
 */

import type {
  BoardId,
  ChangelogId,
  PostCommentId,
  PostId,
  PrincipalId,
  UserId,
} from '@quackback/ids'

import type {
  EventActor,
  EventConversationData,
  EventConversationRef,
  EventData,
  EventMessageData,
  EventPostRef,
} from './types.js'
import { realEmail } from '@/lib/shared/anonymous-email'
import { logger } from '@/lib/server/logger'

// Re-export EventActor for API routes that need to construct actor objects
export type { EventActor } from './types.js'

const log = logger.child({ component: 'dispatch' })

/**
 * Build an EventActor from a principal with optional user details.
 * Constructs a 'user' actor when userId is present, otherwise a 'service' actor.
 *
 * `displayName` is preserved on user actors too (not just service) so
 * downstream handlers — notification text, mention email "by X" line —
 * can render the actor's name instead of falling back to "Anonymous user".
 * `name` is accepted as a fallback so callers passing a plain `author`
 * object (which uses `name`, not `displayName`) don't need to remap.
 */
export function buildEventActor(actor: {
  principalId: PrincipalId
  userId?: UserId
  email?: string
  displayName?: string
  name?: string
}): EventActor {
  const displayName = actor.displayName ?? actor.name
  if (actor.userId) {
    return {
      type: 'user',
      principalId: actor.principalId,
      userId: actor.userId,
      // Anonymous users carry a synthetic placeholder email — never put it on
      // the event actor (it reaches webhooks, integrations, the pipeline).
      email: realEmail(actor.email) ?? undefined,
      displayName,
    }
  }
  return { type: 'service', principalId: actor.principalId, displayName }
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
  id: PostCommentId
  content: string
  authorEmail?: string
  authorName?: string
  isPrivate?: boolean
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
  return { id: globalThis.crypto.randomUUID(), timestamp: new Date().toISOString(), actor } as const
}

/**
 * Dispatch and process an event.
 * Awaiting ensures targets are resolved and jobs enqueued.
 * Hook execution runs in the background via BullMQ.
 */
async function dispatchEvent(event: EventData, opts?: { rethrow?: boolean }): Promise<void> {
  log.debug({ event_type: event.type, event_id: event.id }, 'dispatching event')
  try {
    const { processEvent } = await import('./process')
    await processEvent(event)
  } catch (error) {
    log.error({ err: error, event_type: event.type, event_id: event.id }, 'failed to process event')
    // Dispatch is best-effort by default (a failed webhook enqueue must not
    // fail the user action). Callers that own a retry/recovery path opt into
    // propagation so they can react to an enqueue failure.
    if (opts?.rethrow) throw error
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

export interface PostMentionedInput {
  postId: PostId
  postTitle: string
  postUrl: string
  mentionedPrincipalId: PrincipalId
  mentioningPrincipalId: PrincipalId
  excerpt: string
}

export async function dispatchPostMentioned(
  actor: EventActor,
  input: PostMentionedInput
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'post.mentioned',
    data: {
      postId: input.postId,
      postTitle: input.postTitle,
      postUrl: input.postUrl,
      mentionedPrincipalId: input.mentionedPrincipalId,
      mentioningPrincipalId: input.mentioningPrincipalId,
      excerpt: input.excerpt,
    },
  })
}

export async function dispatchPostUpdated(
  actor: EventActor,
  post: EventPostRef,
  changedFields: string[]
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'post.updated',
    data: { post, changedFields },
  })
}

export async function dispatchPostDeleted(actor: EventActor, post: EventPostRef): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'post.deleted',
    data: {
      post,
      deletedBy: actor.email || actor.displayName,
    },
  })
}

export async function dispatchPostRestored(actor: EventActor, post: EventPostRef): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'post.restored',
    data: { post },
  })
}

export async function dispatchPostMerged(
  actor: EventActor,
  duplicatePost: EventPostRef,
  canonicalPost: EventPostRef
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'post.merged',
    data: { duplicatePost, canonicalPost },
  })
}

export async function dispatchPostUnmerged(
  actor: EventActor,
  post: EventPostRef,
  formerCanonicalPost: EventPostRef
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'post.unmerged',
    data: { post, formerCanonicalPost },
  })
}

export interface CommentUpdatedInput {
  id: PostCommentId
  content: string
  authorEmail?: string
  authorName?: string
  isPrivate?: boolean
}

export async function dispatchCommentUpdated(
  actor: EventActor,
  comment: CommentUpdatedInput,
  post: CommentPostInput
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'comment.updated',
    data: { comment, post },
  })
}

export interface CommentDeletedInput {
  id: PostCommentId
  isPrivate?: boolean
}

export async function dispatchCommentDeleted(
  actor: EventActor,
  comment: CommentDeletedInput,
  post: CommentPostInput
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'comment.deleted',
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
  changelog: ChangelogPublishedInput,
  opts?: { rethrow?: boolean }
): Promise<void> {
  await dispatchEvent(
    {
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
    },
    opts
  )
}

export async function dispatchConversationCreated(
  actor: EventActor,
  conversation: EventConversationData
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.created',
    data: { conversation },
  })
}

export async function dispatchConversationStatusChanged(
  actor: EventActor,
  conversation: EventConversationRef,
  previousStatus: string,
  newStatus: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.status_changed',
    data: { conversation, previousStatus, newStatus },
  })
}

export async function dispatchConversationAssigned(
  actor: EventActor,
  conversation: EventConversationRef,
  assignedAgentPrincipalId: string | null,
  previousAgentPrincipalId: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.assigned',
    data: { conversation, assignedAgentPrincipalId, previousAgentPrincipalId },
  })
}

export async function dispatchConversationPriorityChanged(
  actor: EventActor,
  conversation: EventConversationRef,
  previousPriority: string,
  newPriority: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.priority_changed',
    data: { conversation, previousPriority, newPriority },
  })
}

export async function dispatchConversationCsatSubmitted(
  actor: EventActor,
  conversation: EventConversationRef,
  rating: number,
  comment: string | null,
  submittedAt: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.csat_submitted',
    data: { conversation, rating, comment, submittedAt },
  })
}

export async function dispatchConversationCsatCommentAdded(
  actor: EventActor,
  conversation: EventConversationRef,
  rating: number,
  comment: string,
  submittedAt: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.csat_comment_added',
    data: { conversation, rating, comment, submittedAt },
  })
}

export async function dispatchMessageCreated(
  actor: EventActor,
  message: EventMessageData,
  conversation: EventConversationRef
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'message.created',
    data: { message, conversation },
  })
}

export async function dispatchMessageNoteCreated(
  actor: EventActor,
  message: EventMessageData,
  conversation: EventConversationRef
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'message.note_created',
    data: { message, conversation },
  })
}

export async function dispatchMessageDeleted(
  actor: EventActor,
  message: { id: string; conversationId: string },
  conversation: EventConversationRef
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'message.deleted',
    data: { message, conversation },
  })
}
