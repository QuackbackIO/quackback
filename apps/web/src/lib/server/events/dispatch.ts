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
  ConversationUnresponsivePayload,
  EventActor,
  EventConversationData,
  EventConversationRef,
  EventData,
  EventMessageData,
  EventPostRef,
  EventTicketData,
  EventTicketMessageAttachment,
  EventTicketRef,
  SlaTimerPayload,
} from './types.js'
import type { JsonValue } from '@/lib/shared/json'
import type { ConversationAttributeSource } from '@/lib/shared/conversation/attribute-values'
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
  previousAgentPrincipalId: string | null,
  assignedTeamId: string | null,
  previousTeamId: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.assigned',
    data: {
      conversation,
      assignedAgentPrincipalId,
      previousAgentPrincipalId,
      assignedTeamId,
      previousTeamId,
    },
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

export async function dispatchConversationAttributeChanged(
  actor: EventActor,
  conversation: EventConversationRef,
  key: string,
  value: JsonValue | null,
  source: ConversationAttributeSource
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.attribute_changed',
    data: { conversationId: conversation.id, conversation, key, value, source },
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

export interface ConversationNoteMentionedInput {
  conversationId: string
  conversationMessageId: string
  mentionedPrincipalIds: string[]
  authorName: string
  preview: string
}

export async function dispatchConversationNoteMentioned(
  actor: EventActor,
  input: ConversationNoteMentionedInput
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.note_mentioned',
    data: {
      conversationId: input.conversationId,
      conversationMessageId: input.conversationMessageId,
      mentionedPrincipalIds: input.mentionedPrincipalIds,
      authorName: input.authorName,
      preview: input.preview,
    },
  })
}

export async function dispatchMessageCreated(
  actor: EventActor,
  message: EventMessageData,
  conversation: EventConversationRef,
  isFirstMessage: boolean
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'message.created',
    data: { message, conversation, isFirstMessage },
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

export async function dispatchTicketCreated(
  actor: EventActor,
  ticket: EventTicketData
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.created',
    data: { ticket },
  })
}

export async function dispatchTicketStatusChanged(
  actor: EventActor,
  ticket: EventTicketRef,
  previousStatus: string,
  newStatus: string,
  stage: string | null,
  previousStage: string | null,
  requesterPrincipalId: string | null,
  title: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.status_changed',
    data: { ticket, previousStatus, newStatus, stage, previousStage, requesterPrincipalId, title },
  })
}

export async function dispatchTicketAssigned(
  actor: EventActor,
  ticket: EventTicketRef,
  assignedPrincipalId: string | null,
  previousPrincipalId: string | null,
  assignedTeamId: string | null,
  previousTeamId: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.assigned',
    data: { ticket, assignedPrincipalId, previousPrincipalId, assignedTeamId, previousTeamId },
  })
}

export async function dispatchTicketReplied(
  actor: EventActor,
  ticket: EventTicketRef,
  messageId: string,
  content: string,
  attachments: EventTicketMessageAttachment[] | null,
  senderType: 'agent' | 'visitor',
  title: string,
  authorName: string | null,
  requesterPrincipalId: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.replied',
    data: {
      ticket,
      messageId,
      content,
      attachments,
      senderType,
      title,
      authorName,
      requesterPrincipalId,
    },
  })
}

export async function dispatchTicketNoteAdded(
  actor: EventActor,
  ticket: EventTicketRef,
  messageId: string,
  content: string,
  attachments: EventTicketMessageAttachment[] | null,
  senderType: 'agent' | 'visitor',
  title: string,
  authorName: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.note_added',
    data: { ticket, messageId, content, attachments, senderType, title, authorName },
  })
}

export async function dispatchAssistantHandedOff(
  actor: EventActor,
  conversationId: string,
  reason: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'assistant.handed_off',
    data: { conversationId, reason },
  })
}

// ---------------------------------------------------------------------------
// Timer-driven workflow triggers (support platform §4.6): synthetic events
// raised by workflow-sweep.ts's 5-minute tick or the SLA domain's deadline
// scan, never by a human/system action. No human or service PRINCIPAL causes
// these — the actor is a fixed, non-attributable marker, distinct from a real
// service actor (Quinn, an integration) which always carries a principalId.
// ---------------------------------------------------------------------------

/** The fixed actor every timer-driven trigger carries — there is no
 *  principal to attribute a scheduled sweep tick to. `actorType` reads
 *  'service' downstream (event-trigger.ts), same as any other automated
 *  actor, but these four trigger types opt out of the automated-actor gate
 *  entirely (see event-trigger.ts's switch) since a workflow action can never
 *  itself produce silence or an SLA deadline — there is no re-trigger loop to
 *  guard against here. */
const TIMER_TRIGGER_ACTOR: EventActor = { type: 'service', displayName: 'Scheduled sweep' }

/**
 * Envelope for a synthetic timer-driven event, with a CALLER-SUPPLIED `id`
 * instead of eventEnvelope's random UUID. This is deliberate, not an
 * oversight: workflow-dispatch-queue.ts keys its BullMQ job id off
 * `event.id`, so a deterministic id (built by the caller from the trigger
 * type + workflow + conversation + a stable anchor — see
 * workflow-sweep.ts/sla.service.ts) is what makes repeated sweep ticks over
 * the same still-qualifying condition dedupe at the queue instead of firing a
 * fresh run every tick.
 */
function timerEventEnvelope(id: string) {
  return { id, timestamp: new Date().toISOString(), actor: TIMER_TRIGGER_ACTOR } as const
}

/**
 * Fire conversation.customer_unresponsive for the ONE workflow
 * workflow-sweep.ts determined crossed its own `inactivityMinutes` threshold.
 * `id` must be deterministic (see timerEventEnvelope) — workflow-sweep.ts
 * derives it from (triggerType, workflowId, conversationId, sinceAt) so a
 * later tick over the same unbroken silence period reuses the same id.
 */
export async function dispatchConversationCustomerUnresponsive(
  id: string,
  payload: ConversationUnresponsivePayload
): Promise<void> {
  await dispatchEvent({
    ...timerEventEnvelope(id),
    type: 'conversation.customer_unresponsive',
    data: payload,
  })
}

/** Fire conversation.teammate_unresponsive — mirrors
 *  dispatchConversationCustomerUnresponsive; see that doc. */
export async function dispatchConversationTeammateUnresponsive(
  id: string,
  payload: ConversationUnresponsivePayload
): Promise<void> {
  await dispatchEvent({
    ...timerEventEnvelope(id),
    type: 'conversation.teammate_unresponsive',
    data: payload,
  })
}

/**
 * Fire sla.approaching_breach once a conversation's clock enters the lead
 * window. Unlike the unresponsive pair above, `id` need not be reused across
 * ticks for correctness — sla.service.ts's CAS-guarded stamp on
 * `sla_applied` is the actual fire-once dedupe (see its module doc) — but a
 * caller still derives a stable id (conversationId + clock + the SLA
 * application's own `appliedAt`) so a duplicate BullMQ job is never queued
 * for the same claim within the queue's retention window either.
 */
export async function dispatchSlaApproachingBreach(id: string, payload: SlaTimerPayload) {
  await dispatchEvent({
    ...timerEventEnvelope(id),
    type: 'sla.approaching_breach',
    data: payload,
  })
}

/** Fire sla.breached once a conversation's clock passes its due date with no
 *  settling event. Mirrors dispatchSlaApproachingBreach; see that doc. */
export async function dispatchSlaBreached(id: string, payload: SlaTimerPayload) {
  await dispatchEvent({
    ...timerEventEnvelope(id),
    type: 'sla.breached',
    data: payload,
  })
}
