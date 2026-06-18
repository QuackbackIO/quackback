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
  CommentId,
  PostId,
  PrincipalId,
  UserId,
  TicketStatusId,
  InboxId,
  TeamId,
  ContactId,
  OrganizationId,
} from '@quackback/ids'

import type {
  EventActor,
  EventData,
  EventPostRef,
  EventTicketRef,
  EventConversationData,
  EventConversationRef,
  EventMessageData,
  EventInboxRef,
  EventTeamRef,
  EventTicketStatusRef,
  EventContactRef,
  EventOrganizationRef,
} from './types.js'

import { logger } from '@/lib/server/logger'
import { realEmail } from '@/lib/shared/anonymous-email'
import { db, eq, ticketStatuses, inboxes, teams, contacts, organizations } from '@/lib/server/db'
import { getBaseUrl } from '@/lib/server/config'
import { toIsoString } from '@/lib/shared/utils/date'

// Re-export EventActor for API routes that need to construct actor objects
export type { EventActor } from './types.js'

const log = logger.child({ component: 'dispatch' })

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
      // Strip the synthetic anonymous placeholder ("temp-<id>@anon.quackback.io")
      // so it never rides along into event payloads / webhook deliveries. Real
      // user emails pass through unchanged. (Regression guard:
      // build-event-actor.test.ts — this stripping exists on main and must not
      // be lost when dispatch.ts is rewritten.)
      email: realEmail(actor.email) ?? undefined,
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
async function dispatchEvent(event: EventData): Promise<void> {
  log.debug({ event_type: event.type, event_id: event.id }, 'dispatching event')
  try {
    const { processEvent } = await import('./process')
    await processEvent(event)
  } catch (error) {
    log.error({ err: error, event_type: event.type, event_id: event.id }, 'failed to process event')
    await fallbackSendEmails(event)
  }
}

/**
 * Best-effort fallback for when BullMQ/event processing is unavailable.
 * Sends email targets synchronously so critical notifications are not dropped.
 */
async function fallbackSendEmails(event: EventData): Promise<void> {
  try {
    const [{ getHookTargets }, { emailHook }] = await Promise.all([
      import('./targets'),
      import('./handlers/email'),
    ])
    const targets = await getHookTargets(event)
    const emailTargets = targets.filter((t) => t.type === 'email')
    if (emailTargets.length === 0) return

    for (const target of emailTargets) {
      try {
        await emailHook.run(event, target.target, target.config)
      } catch (err) {
        log.error(
          { err, event_type: event.type, event_id: event.id },
          'fallback email delivery failed'
        )
      }
    }
  } catch (err) {
    log.error(
      { err, event_type: event.type, event_id: event.id },
      'fallback email resolution failed'
    )
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
  id: CommentId
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
  id: CommentId
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

// ============================================================================
// Ticket dispatchers (Phase 7.5)
// ============================================================================

interface TicketDispatchOptions {
  syncSourceIntegrationId?: string | null
}

function sourceFields(options?: TicketDispatchOptions) {
  return options?.syncSourceIntegrationId
    ? { syncSourceIntegrationId: options.syncSourceIntegrationId }
    : {}
}

/**
 * Build an `EventTicketRef` from a Drizzle ticket row.
 *
 * Accepts the raw ticket as `Record<string, unknown>` to avoid pulling the
 * Ticket type into this file (which would create a circular import path
 * through @/lib/server/db). Callers pass the ticket they already have.
 */
function ticketRef(t: Record<string, unknown>): EventTicketRef {
  return {
    id: String(t.id),
    subject: (t.subject as string | null) ?? null,
    descriptionText: (t.descriptionText as string | null) ?? null,
    statusId: (t.statusId as string | null) ?? null,
    statusCategory: (t.statusCategory as string | null) ?? null,
    priority: (t.priority as string | null) ?? null,
    channel: (t.channel as string | null) ?? null,
    visibility: (t.visibility as string | null) ?? null,
    inboxId: (t.inboxId as string | null) ?? null,
    primaryTeamId: (t.primaryTeamId as string | null) ?? null,
    assigneePrincipalId: (t.assigneePrincipalId as string | null) ?? null,
    assigneeTeamId: (t.assigneeTeamId as string | null) ?? null,
    requesterPrincipalId: (t.requesterPrincipalId as string | null) ?? null,
    requesterContactId: (t.requesterContactId as string | null) ?? null,
  }
}

/**
 * Enrich a bare {@link ticketRef} with snapshot fields that downstream
 * consumers (webhook deliveries, ticket-targets notification builders) read
 * directly off the event payload — the related-entity display names, the
 * requester's contact details, the organization, the created-at ISO string,
 * and a deep-link `ticketUrl`. Each lookup is guarded by the presence of its
 * id, so null ids cost no queries. The whole enrichment is best-effort: if any
 * query throws we log and fall back to the bare ref rather than dropping the
 * event, since the snapshot fields are convenience metadata, not load-bearing.
 *
 * Regression coverage: dispatch-enrichment.test.ts pins the lookup/skip/
 * fallback/team-reuse behaviour exercised here.
 */
async function buildTicketRef(t: Record<string, unknown>): Promise<EventTicketRef> {
  const base = ticketRef(t)
  try {
    const enriched: EventTicketRef = { ...base }

    // Status name
    enriched.statusName = base.statusId
      ? ((
          await db.query.ticketStatuses.findFirst({
            where: eq(ticketStatuses.id, base.statusId as TicketStatusId),
            columns: { name: true },
          })
        )?.name ?? null)
      : null

    // Inbox name + slug
    if (base.inboxId) {
      const inbox = await db.query.inboxes.findFirst({
        where: eq(inboxes.id, base.inboxId as InboxId),
        columns: { name: true, slug: true },
      })
      enriched.inboxName = inbox?.name ?? null
      enriched.inboxSlug = inbox?.slug ?? null
    } else {
      enriched.inboxName = null
      enriched.inboxSlug = null
    }

    // Team names — fetch each distinct team id once, then reuse for both the
    // primary team and the assignee team (they are frequently the same).
    const teamNameCache = new Map<string, string | null>()
    const teamName = async (id: string | null): Promise<string | null> => {
      if (!id) return null
      if (teamNameCache.has(id)) return teamNameCache.get(id) ?? null
      const row = await db.query.teams.findFirst({
        where: eq(teams.id, id as TeamId),
        columns: { name: true },
      })
      const name = row?.name ?? null
      teamNameCache.set(id, name)
      return name
    }
    enriched.primaryTeamName = await teamName(base.primaryTeamId)
    enriched.assigneeTeamName = await teamName(base.assigneeTeamId)

    // Requester contact (name + email, plus its organization for the org snapshot)
    let contactOrgId: string | null = null
    if (base.requesterContactId) {
      const contact = await db.query.contacts.findFirst({
        where: eq(contacts.id, base.requesterContactId as ContactId),
        columns: { name: true, email: true, organizationId: true },
      })
      enriched.requesterName = contact?.name ?? null
      // Never leak a synthetic anonymous placeholder address into the payload.
      enriched.requesterEmail = realEmail(contact?.email) ?? null
      contactOrgId = (contact?.organizationId as string | null) ?? null
    } else {
      enriched.requesterName = null
      enriched.requesterEmail = null
    }

    // Organization — prefer the ticket's own org, else the requester contact's.
    const organizationId = ((t.organizationId as string | null) ?? null) || contactOrgId
    if (organizationId) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, organizationId as OrganizationId),
        columns: { name: true, domain: true },
      })
      enriched.organizationName = org?.name ?? null
      enriched.organizationDomain = org?.domain ?? null
    } else {
      enriched.organizationName = null
      enriched.organizationDomain = null
    }

    // Created-at snapshot (ISO) + admin deep link.
    if (t.createdAt) enriched.createdAt = toIsoString(t.createdAt as Date | string)
    enriched.ticketUrl = `${getBaseUrl()}/admin/tickets/${base.id}`

    return enriched
  } catch (err) {
    // Best-effort: a failed snapshot lookup must not drop the event. Use
    // console.warn (not the structured logger) so the failure is always
    // surfaced even before logger transports are wired.
    console.warn('[dispatch] ticket ref enrichment failed; using bare ref', err)
    return base
  }
}

export async function dispatchTicketCreated(
  actor: EventActor,
  ticket: Record<string, unknown>,
  options?: TicketDispatchOptions
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    ...sourceFields(options),
    type: 'ticket.created',
    data: { ticket: await buildTicketRef(ticket) },
  })
}

export async function dispatchTicketAssigned(
  actor: EventActor,
  ticket: Record<string, unknown>,
  previousAssigneePrincipalId: string | null,
  newAssigneePrincipalId: string | null,
  options?: TicketDispatchOptions
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    ...sourceFields(options),
    type: 'ticket.assigned',
    data: {
      ticket: await buildTicketRef(ticket),
      previousAssigneePrincipalId,
      newAssigneePrincipalId,
    },
  })
}

export async function dispatchTicketUnassigned(
  actor: EventActor,
  ticket: Record<string, unknown>,
  previousAssigneePrincipalId: string | null,
  options?: TicketDispatchOptions
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    ...sourceFields(options),
    type: 'ticket.unassigned',
    data: { ticket: await buildTicketRef(ticket), previousAssigneePrincipalId },
  })
}

export async function dispatchTicketStatusChanged(
  actor: EventActor,
  ticket: Record<string, unknown>,
  previousStatusCategory: string | null,
  newStatusCategory: string,
  options?: TicketDispatchOptions
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    ...sourceFields(options),
    type: 'ticket.status_changed',
    data: { ticket: await buildTicketRef(ticket), previousStatusCategory, newStatusCategory },
  })
}

export async function dispatchTicketThreadAdded(
  actor: EventActor,
  ticket: Record<string, unknown>,
  threadId: string,
  audience: 'public' | 'internal' | 'shared_team',
  sharedWithTeamId: string | null,
  thread?: {
    bodyTextPreview: string
    bodyText?: string
    bodyTextTruncated: boolean
    authorPrincipalId: string | null
    isFromRequester: boolean
    createdAt: Date | string
  },
  options?: TicketDispatchOptions
): Promise<void> {
  const threadSnapshot = thread
    ? {
        id: threadId,
        audience,
        bodyTextPreview: thread.bodyTextPreview,
        bodyText: thread.bodyText,
        bodyTextTruncated: thread.bodyTextTruncated,
        authorPrincipalId: thread.authorPrincipalId,
        isFromRequester: thread.isFromRequester,
        sharedWithTeamId,
        createdAt:
          typeof thread.createdAt === 'string' ? thread.createdAt : thread.createdAt.toISOString(),
      }
    : undefined
  await dispatchEvent({
    ...eventEnvelope(actor),
    ...sourceFields(options),
    type: 'ticket.thread_added',
    data: {
      ticket: await buildTicketRef(ticket),
      threadId,
      audience,
      sharedWithTeamId,
      thread: threadSnapshot,
    },
  })
}

export async function dispatchTicketThreadUpdated(
  actor: EventActor,
  ticket: Record<string, unknown>,
  threadId: string,
  audience: 'public' | 'internal' | 'shared_team',
  sharedWithTeamId: string | null,
  thread: {
    bodyTextPreview: string
    bodyText?: string
    bodyTextTruncated: boolean
    authorPrincipalId: string | null
    isFromRequester: boolean
    createdAt: Date | string
    editedAt: Date | string | null
  },
  options?: TicketDispatchOptions
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    ...sourceFields(options),
    type: 'ticket.thread_updated',
    data: {
      ticket: await buildTicketRef(ticket),
      threadId,
      audience,
      sharedWithTeamId,
      thread: {
        id: threadId,
        audience,
        bodyTextPreview: thread.bodyTextPreview,
        bodyText: thread.bodyText,
        bodyTextTruncated: thread.bodyTextTruncated,
        authorPrincipalId: thread.authorPrincipalId,
        isFromRequester: thread.isFromRequester,
        sharedWithTeamId,
        createdAt:
          typeof thread.createdAt === 'string' ? thread.createdAt : thread.createdAt.toISOString(),
        editedAt:
          thread.editedAt == null
            ? null
            : typeof thread.editedAt === 'string'
              ? thread.editedAt
              : thread.editedAt.toISOString(),
      },
    },
  })
}

export async function dispatchTicketThreadDeleted(
  actor: EventActor,
  ticket: Record<string, unknown>,
  threadId: string,
  audience: 'public' | 'internal' | 'shared_team',
  sharedWithTeamId: string | null,
  deletedByPrincipalId: string | null,
  thread?: {
    bodyTextPreview: string
    bodyText?: string
    bodyTextTruncated: boolean
    authorPrincipalId: string | null
    isFromRequester: boolean
    createdAt: Date | string
  },
  options?: TicketDispatchOptions
): Promise<void> {
  const threadSnapshot = thread
    ? {
        id: threadId,
        audience,
        bodyTextPreview: thread.bodyTextPreview,
        bodyText: thread.bodyText,
        bodyTextTruncated: thread.bodyTextTruncated,
        authorPrincipalId: thread.authorPrincipalId,
        isFromRequester: thread.isFromRequester,
        sharedWithTeamId,
        createdAt:
          typeof thread.createdAt === 'string' ? thread.createdAt : thread.createdAt.toISOString(),
      }
    : undefined
  await dispatchEvent({
    ...eventEnvelope(actor),
    ...sourceFields(options),
    type: 'ticket.thread_deleted',
    data: {
      ticket: await buildTicketRef(ticket),
      threadId,
      audience,
      sharedWithTeamId,
      deletedByPrincipalId,
      thread: threadSnapshot,
    },
  })
}

export async function dispatchTicketParticipantAdded(
  actor: EventActor,
  ticket: Record<string, unknown>,
  addedPrincipalId: string | null,
  role: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.participant_added',
    data: { ticket: await buildTicketRef(ticket), addedPrincipalId, role },
  })
}

export async function dispatchTicketParticipantRemoved(
  actor: EventActor,
  ticket: Record<string, unknown>,
  removedPrincipalId: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.participant_removed',
    data: { ticket: await buildTicketRef(ticket), removedPrincipalId },
  })
}

export async function dispatchTicketShared(
  actor: EventActor,
  ticket: Record<string, unknown>,
  teamId: string,
  accessLevel: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.shared',
    data: { ticket: await buildTicketRef(ticket), teamId, accessLevel },
  })
}

export async function dispatchTicketUnshared(
  actor: EventActor,
  ticket: Record<string, unknown>,
  teamId: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.unshared',
    data: { ticket: await buildTicketRef(ticket), teamId },
  })
}

export async function dispatchTicketSlaWarning(
  actor: EventActor,
  ticket: Record<string, unknown>,
  kind: string,
  ruleName: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.sla_warning',
    data: { ticket: await buildTicketRef(ticket), kind, ruleName },
  })
}

export async function dispatchTicketSlaBreach(
  actor: EventActor,
  ticket: Record<string, unknown>,
  kind: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.sla_breach',
    data: { ticket: await buildTicketRef(ticket), kind },
  })
}

export async function dispatchTicketRestored(
  actor: EventActor,
  ticket: Record<string, unknown>,
  restoredByPrincipalId: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.restored',
    data: { ticket: await buildTicketRef(ticket), restoredByPrincipalId },
  })
}

export async function dispatchTicketUpdated(
  actor: EventActor,
  ticket: Record<string, unknown>,
  changedFields: string[],
  diff: Record<string, { from: unknown; to: unknown }>,
  options?: TicketDispatchOptions
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    ...sourceFields(options),
    type: 'ticket.updated',
    data: { ticket: await buildTicketRef(ticket), changedFields, diff },
  })
}

export async function dispatchTicketFirstResponse(
  actor: EventActor,
  ticket: Record<string, unknown>,
  threadId: string,
  firstResponseAt: string,
  options?: TicketDispatchOptions
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    ...sourceFields(options),
    type: 'ticket.first_response',
    data: { ticket: await buildTicketRef(ticket), threadId, firstResponseAt },
  })
}

export async function dispatchTicketAttachmentAdded(
  actor: EventActor,
  ticket: Record<string, unknown>,
  attachment: {
    id: string
    threadId: string
    filename: string
    mimeType: string
    sizeBytes: number
    uploadedByPrincipalId: string | null
    publicUrl: string | null
  }
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.attachment_added',
    data: { ticket: await buildTicketRef(ticket), attachment },
  })
}

export async function dispatchTicketAttachmentRemoved(
  actor: EventActor,
  ticket: Record<string, unknown>,
  attachment: { id: string; threadId: string; filename: string },
  removedByPrincipalId: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket.attachment_removed',
    data: { ticket: await buildTicketRef(ticket), attachment, removedByPrincipalId },
  })
}

export async function dispatchTicketDeleted(
  actor: EventActor,
  ticket: Record<string, unknown>,
  deletedByPrincipalId: string | null,
  options?: TicketDispatchOptions
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    ...sourceFields(options),
    type: 'ticket.deleted',
    data: { ticket: await buildTicketRef(ticket), deletedByPrincipalId },
  })
}

// ---------------------------------------------------------------------------
// Post mention events
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Conversation / message events (live-chat bridge)
// ---------------------------------------------------------------------------

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
  previousAgentPrincipalId: string | null,
  newAgentPrincipalId: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.assigned',
    data: { conversation, assignedAgentPrincipalId: newAgentPrincipalId, previousAgentPrincipalId },
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
  comment?: string | null,
  submittedAt?: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'conversation.csat_submitted',
    data: {
      conversation,
      rating,
      comment: comment ?? null,
      submittedAt: submittedAt ?? new Date().toISOString(),
    },
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

// ---------------------------------------------------------------------------
// Inbox events
// ---------------------------------------------------------------------------

export async function dispatchInboxCreated(actor: EventActor, inbox: EventInboxRef): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'inbox.created',
    data: { inbox },
  })
}

export async function dispatchInboxUpdated(
  actor: EventActor,
  inbox: EventInboxRef,
  changedFields: string[]
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'inbox.updated',
    data: { inbox, changedFields },
  })
}

export async function dispatchInboxArchived(
  actor: EventActor,
  inbox: EventInboxRef
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'inbox.archived',
    data: { inbox },
  })
}

export async function dispatchInboxUnarchived(
  actor: EventActor,
  inbox: EventInboxRef
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'inbox.unarchived',
    data: { inbox },
  })
}

// ---------------------------------------------------------------------------
// Team events
// ---------------------------------------------------------------------------

export async function dispatchTeamCreated(actor: EventActor, team: EventTeamRef): Promise<void> {
  await dispatchEvent({ ...eventEnvelope(actor), type: 'team.created', data: { team } })
}

export async function dispatchTeamUpdated(
  actor: EventActor,
  team: EventTeamRef,
  changedFields: string[]
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'team.updated',
    data: { team, changedFields },
  })
}

export async function dispatchTeamArchived(actor: EventActor, team: EventTeamRef): Promise<void> {
  await dispatchEvent({ ...eventEnvelope(actor), type: 'team.archived', data: { team } })
}

// ---------------------------------------------------------------------------
// Ticket status events
// ---------------------------------------------------------------------------

export async function dispatchTicketStatusCreated(
  actor: EventActor,
  status: EventTicketStatusRef
): Promise<void> {
  await dispatchEvent({ ...eventEnvelope(actor), type: 'ticket_status.created', data: { status } })
}

export async function dispatchTicketStatusUpdated(
  actor: EventActor,
  status: EventTicketStatusRef,
  changedFields: string[]
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'ticket_status.updated',
    data: { status, changedFields },
  })
}

// ---------------------------------------------------------------------------
// Contact events
// ---------------------------------------------------------------------------

export async function dispatchContactCreated(
  actor: EventActor,
  contact: EventContactRef
): Promise<void> {
  await dispatchEvent({ ...eventEnvelope(actor), type: 'contact.created', data: { contact } })
}

export async function dispatchContactUpdated(
  actor: EventActor,
  contact: EventContactRef,
  changedFields: string[]
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'contact.updated',
    data: { contact, changedFields },
  })
}

export async function dispatchContactArchived(
  actor: EventActor,
  contact: EventContactRef
): Promise<void> {
  await dispatchEvent({ ...eventEnvelope(actor), type: 'contact.archived', data: { contact } })
}

export async function dispatchContactLinked(
  actor: EventActor,
  contact: EventContactRef,
  userId: string,
  linkedByPrincipalId: string | null
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'contact.linked',
    data: { contact, userId, linkedByPrincipalId },
  })
}

export async function dispatchContactUnlinked(
  actor: EventActor,
  contact: EventContactRef,
  userId: string
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'contact.unlinked',
    data: { contact, userId },
  })
}

// ---------------------------------------------------------------------------
// Organization events
// ---------------------------------------------------------------------------

export async function dispatchOrganizationCreated(
  actor: EventActor,
  organization: EventOrganizationRef
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'organization.created',
    data: { organization },
  })
}

export async function dispatchOrganizationUpdated(
  actor: EventActor,
  organization: EventOrganizationRef,
  changedFields: string[]
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'organization.updated',
    data: { organization, changedFields },
  })
}

export async function dispatchOrganizationArchived(
  actor: EventActor,
  organization: EventOrganizationRef
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'organization.archived',
    data: { organization },
  })
}

export async function dispatchOrganizationUnarchived(
  actor: EventActor,
  organization: EventOrganizationRef
): Promise<void> {
  await dispatchEvent({
    ...eventEnvelope(actor),
    type: 'organization.unarchived',
    data: { organization },
  })
}
