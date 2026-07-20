/**
 * Read-side queries + DTO mappers for support-inbox conversations. Keyset pagination on
 * (created_at, id); a conversation is flat, so no comment-tree reconstruction.
 */
import {
  db,
  conversations,
  conversationMessages,
  principal,
  eq,
  and,
  or,
  lt,
  gt,
  inArray,
  isNull,
  isNotNull,
  desc,
  asc,
  sql,
  posts,
  boards,
  postExternalLinks,
  conversationTags,
  conversationTagAssignments,
  conversationMessageMentions,
  conversationMessageReactions,
  conversationMessageFlags,
  userSegments,
  segments,
  assistantInvolvements,
  ticketConversations,
  tickets,
  type Conversation,
  type ConversationMessage,
  type PostSuggestion,
  type AssistantPendingActionSurface,
  type AssistantInvolvementStatus,
  type TranslatedFromMetadata,
} from '@/lib/server/db'
import {
  toUuid,
  type ConversationId,
  type PrincipalId,
  type PostId,
  type ConversationTagId,
  type ConversationMessageId,
  type SegmentId,
  type CompanyId,
  type TeamId,
  type TicketId,
} from '@quackback/ids'
import type {
  ConversationSort,
  ConversationAttributeFilterParam,
  ConversationAttributeOperator,
} from '@/lib/shared/conversation/views'
import { nextSlaDue } from '@/lib/shared/conversation/sla'
import type { SlaApplied } from '@/lib/server/domains/sla/sla.service'
import { assistantPrincipalIdOnce } from '@/lib/server/messages/assistant-principal'
import { conversationFilter } from '@/lib/server/policy/conversations'
import type { Actor } from '@/lib/server/policy/types'
import { priorityRankSql } from '@/lib/server/utils/priority-rank'
import {
  ascColumn,
  buildKeysetCondition,
  descColumn,
  type KeysetColumn,
} from '@/lib/server/db/keyset'
import { PRIORITY_RANK } from '@/lib/shared/conversation/priority-meta'
import { loadAuthors, fallbackAuthor } from '../principals/principal-display'
import { toMessageDTO } from '@/lib/server/messages/message-core'
import { aggregateReactions } from '@/lib/shared'
import { truncate } from '@/lib/shared/utils/string'
import type { JsonValue } from '@/lib/shared/json'
import type {
  ConversationAuthorDTO,
  ConversationMessageDTO,
  AgentConversationMessageDTO,
  MessageReactionCount,
  FlaggedMessageDTO,
  ConversationDTO,
  ConversationSlaDTO,
  ConversationTagDTO,
  MessageSenderType,
  ConversationStatus,
  ConversationEndReason,
  ConversationTranslationStateDTO,
} from '@/lib/shared/conversation/types'

const MESSAGE_PAGE_SIZE = 30
const INBOX_PAGE_SIZE = 25

// loadAuthors/fallbackAuthor now live in the principals domain (principal
// display is a principal concern). Re-exported here because the inbox, the
// message stream, and their test mocks reference them from this module.
export { loadAuthors, fallbackAuthor }

/** Build an author DTO from a send-call author input (no DB round trip). */
export function authorFromInput(input: {
  principalId: PrincipalId
  displayName?: string | null
  avatarUrl?: string | null
}): ConversationAuthorDTO {
  return {
    principalId: input.principalId,
    displayName: input.displayName ?? null,
    avatarUrl: input.avatarUrl ?? null,
  }
}

/**
 * Resolve a send-call author for the returned/broadcast DTO. The avatar comes
 * from the canonical resolver (loadAuthors: user.image → uploaded image_key →
 * principal copy) so a just-sent message shows the same avatar a reload would —
 * the session only carries `user.image`, which is null for uploaded avatars. The
 * live session display name is preferred; we fall back to the input entirely if
 * the principal row can't be found.
 */
export async function resolveAuthor(input: {
  principalId: PrincipalId
  displayName?: string | null
  avatarUrl?: string | null
}): Promise<ConversationAuthorDTO> {
  const resolved = (await loadAuthors([input.principalId])).get(input.principalId)
  if (!resolved) return authorFromInput(input)
  return {
    principalId: input.principalId,
    displayName: input.displayName ?? resolved.displayName,
    avatarUrl: resolved.avatarUrl ?? input.avatarUrl ?? null,
  }
}

// toMessageDTO now lives in the shared message core (a message is a peer concern
// of conversations and tickets). Re-exported here because the inbox, message
// stream, and their test mocks reference it from this module.
export { toMessageDTO }

/** Batch-load reactions for a page of messages, aggregated per message with the
 *  viewing agent's `hasReacted`. Agent-only — never called on a visitor path. */
async function loadReactionsForMessages(
  messageIds: ConversationMessageId[],
  viewerPrincipalId: PrincipalId
): Promise<Map<ConversationMessageId, MessageReactionCount[]>> {
  const map = new Map<ConversationMessageId, MessageReactionCount[]>()
  if (messageIds.length === 0) return map
  const rows = await db
    .select({
      conversationMessageId: conversationMessageReactions.conversationMessageId,
      emoji: conversationMessageReactions.emoji,
      principalId: conversationMessageReactions.principalId,
      displayName: principal.displayName,
    })
    .from(conversationMessageReactions)
    .leftJoin(principal, eq(principal.id, conversationMessageReactions.principalId))
    .where(inArray(conversationMessageReactions.conversationMessageId, messageIds))
  const byMessage = new Map<
    ConversationMessageId,
    Array<{ emoji: string; principalId: string; displayName: string | null }>
  >()
  for (const row of rows) {
    const list = byMessage.get(row.conversationMessageId) ?? []
    list.push({ emoji: row.emoji, principalId: row.principalId, displayName: row.displayName })
    byMessage.set(row.conversationMessageId, list)
  }
  for (const [id, list] of byMessage) {
    map.set(id, aggregateReactions(list, viewerPrincipalId))
  }
  return map
}

/** Batch-load the VIEWING agent's personal flag (flaggedAt ISO) for a page of
 *  messages — flags are per-agent ("Saved for later"). */
async function loadFlagsForMessages(
  messageIds: ConversationMessageId[],
  viewerPrincipalId: PrincipalId
): Promise<Map<ConversationMessageId, string>> {
  const map = new Map<ConversationMessageId, string>()
  if (messageIds.length === 0) return map
  const rows = await db
    .select({
      conversationMessageId: conversationMessageFlags.conversationMessageId,
      flaggedAt: conversationMessageFlags.flaggedAt,
    })
    .from(conversationMessageFlags)
    .where(
      and(
        inArray(conversationMessageFlags.conversationMessageId, messageIds),
        eq(conversationMessageFlags.principalId, viewerPrincipalId)
      )
    )
  for (const row of rows) {
    map.set(row.conversationMessageId, row.flaggedAt.toISOString())
  }
  return map
}

/**
 * Attach the agent-only reaction + flag + post-suggestion fields to a page of
 * base message DTOs. This is the ONLY place those fields are added — the shared
 * `toMessageDTO` stays clean, so no visitor-facing path can leak them (a visitor
 * function returning ConversationMessageDTO[] simply never has them). Agent paths call
 * this after listMessages to upgrade to AgentConversationMessageDTO[].
 *
 * The post suggestion is supplied in-memory via `postSuggestions` (built by
 * `listMessages` from the rows it already loaded) — it is NOT re-read here, so
 * there's no second `SELECT metadata` round-trip. The map is keyed by message id
 * and only ever carries internal-note suggestions. `pendingActionPointers`
 * mirrors it for Quinn's approval-gated proposals: a pointer only, not the
 * live status — the approval card re-fetches the pending-action row itself.
 */
export async function enrichMessagesForAgent(
  messages: ConversationMessageDTO[],
  viewerPrincipalId: PrincipalId,
  postSuggestions: Map<ConversationMessageId, PostSuggestion>,
  pendingActionPointers: Map<ConversationMessageId, AssistantPendingActionSurface> = new Map(),
  // Agent-only (P2-D.1 inbox translation): the pre-translation original of an
  // OUTGOING message sent while translation was active, carried in-memory off
  // `metadata.translatedFrom` the same way postSuggestion/pendingAction are —
  // no second `SELECT metadata` round-trip.
  translatedFromPointers: Map<ConversationMessageId, TranslatedFromMetadata> = new Map()
): Promise<AgentConversationMessageDTO[]> {
  const ids = messages.map((m) => m.id)
  const [reactions, flags] = await Promise.all([
    loadReactionsForMessages(ids, viewerPrincipalId),
    loadFlagsForMessages(ids, viewerPrincipalId),
  ])
  return messages.map((m) => ({
    ...m,
    reactions: reactions.get(m.id) ?? [],
    flaggedAt: flags.get(m.id) ?? null,
    postSuggestion: postSuggestions.get(m.id) ?? null,
    assistantPendingAction: pendingActionPointers.get(m.id) ?? undefined,
    translatedFrom: translatedFromPointers.get(m.id) ?? null,
  }))
}

/** Single-message agent enrichment — used to build the realtime `message_updated`
 *  payload after a reaction or flag toggle, and the suggest-post broadcast. The
 *  in-memory `postSuggestion` (already known to the caller) is threaded straight
 *  through, never re-read from the DB. */
export async function enrichMessageForAgent(
  message: ConversationMessageDTO,
  viewerPrincipalId: PrincipalId,
  postSuggestion: PostSuggestion | null = null
): Promise<AgentConversationMessageDTO> {
  const suggestions = new Map<ConversationMessageId, PostSuggestion>()
  if (postSuggestion) suggestions.set(message.id, postSuggestion)
  const [one] = await enrichMessagesForAgent([message], viewerPrincipalId, suggestions)
  return one
}

/**
 * The viewing agent's "Saved for later" feed: their flagged messages, newest
 * flag first, each with a preview + the parent thread it belongs to (a
 * conversation OR a ticket — exactly one of `conversationId`/`ticketId` is set
 * on the DTO) so the list can link straight to it. Soft-deleted messages are
 * skipped. Two branches, unioned in memory and re-sorted by flag time: the
 * conversation branch is unchanged; the ticket branch additionally applies
 * `ticketFilter(actor)` (unlike the conversation branch, which trusts the
 * flag ownership alone — flagging is per-agent already, but a ticket's
 * visibility can narrow further by team/assignment, so a flag on a ticket the
 * viewer no longer has access to quietly drops out of their feed rather than
 * leaking a peek at it).
 *
 * CONVERGENCE PHASE 3 (justified single-parent branches): this is a
 * per-MESSAGE feed with per-parent provenance, not a thread read — a flagged
 * row lists once, under the parent it actually hangs off. So a linked pair's
 * conversation-parented flags surface in the conversation branch (linking to
 * the shared thread) and its legacy ticket-parented flags in the ticket
 * branch; nothing is hidden and nothing double-lists. It deliberately does
 * NOT fold the pair's parents into one entry.
 */
export async function listFlaggedMessages(actor: Actor): Promise<FlaggedMessageDTO[]> {
  const viewerPrincipalId = actor.principalId
  if (!viewerPrincipalId) return []

  // The two branches are independent reads (different parent table joins,
  // same flag-ownership predicate) — run them concurrently rather than
  // awaiting one after the other.
  const [{ tickets }, { ticketFilter }] = await Promise.all([
    import('@/lib/server/db'),
    import('@/lib/server/policy/tickets'),
  ])
  const [conversationRows, ticketRows] = await Promise.all([
    db
      .select({
        messageId: conversationMessages.id,
        conversationId: conversationMessages.conversationId,
        content: conversationMessages.content,
        senderType: conversationMessages.senderType,
        authorName: principal.displayName,
        visitorPrincipalId: conversations.visitorPrincipalId,
        flaggedAt: conversationMessageFlags.flaggedAt,
      })
      .from(conversationMessageFlags)
      .innerJoin(
        conversationMessages,
        and(
          eq(conversationMessages.id, conversationMessageFlags.conversationMessageId),
          isNull(conversationMessages.deletedAt)
        )
      )
      .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
      .leftJoin(principal, eq(principal.id, conversationMessages.principalId))
      .where(eq(conversationMessageFlags.principalId, viewerPrincipalId))
      .orderBy(desc(conversationMessageFlags.flaggedAt))
      .limit(100),
    db
      .select({
        messageId: conversationMessages.id,
        ticketId: conversationMessages.ticketId,
        content: conversationMessages.content,
        senderType: conversationMessages.senderType,
        authorName: principal.displayName,
        ticketTitle: tickets.title,
        ticketNumber: tickets.number,
        flaggedAt: conversationMessageFlags.flaggedAt,
      })
      .from(conversationMessageFlags)
      .innerJoin(
        conversationMessages,
        and(
          eq(conversationMessages.id, conversationMessageFlags.conversationMessageId),
          isNull(conversationMessages.deletedAt)
        )
      )
      .innerJoin(tickets, and(eq(tickets.id, conversationMessages.ticketId), ticketFilter(actor)))
      .leftJoin(principal, eq(principal.id, conversationMessages.principalId))
      .where(eq(conversationMessageFlags.principalId, viewerPrincipalId))
      .orderBy(desc(conversationMessageFlags.flaggedAt))
      .limit(100),
  ])

  const visitorNames = await loadAuthors(conversationRows.map((r) => r.visitorPrincipalId))
  const fromConversations: FlaggedMessageDTO[] = conversationRows.map((r) => ({
    messageId: r.messageId,
    conversationId: r.conversationId,
    ticketId: null,
    preview: truncate(r.content, 120),
    authorName: r.authorName ?? (r.senderType === 'agent' ? 'Agent' : 'Visitor'),
    conversationLabel: visitorNames.get(r.visitorPrincipalId)?.displayName ?? 'Visitor',
    flaggedAt: r.flaggedAt.toISOString(),
  }))
  const fromTickets: FlaggedMessageDTO[] = ticketRows.map((r) => ({
    messageId: r.messageId,
    conversationId: null,
    ticketId: r.ticketId,
    preview: truncate(r.content, 120),
    authorName: r.authorName ?? (r.senderType === 'agent' ? 'Agent' : 'Visitor'),
    conversationLabel: `#${r.ticketNumber} · ${r.ticketTitle}`,
    flaggedAt: r.flaggedAt.toISOString(),
  }))

  return [...fromConversations, ...fromTickets]
    .sort((a, b) => new Date(b.flaggedAt).getTime() - new Date(a.flaggedAt).getTime())
    .slice(0, 100)
}

/**
 * Project the engine's applied-SLA stamp into the agent-only DTO field. The
 * next-response deadline reads the stamp's own `nextResponseDueAt` — stamped
 * by rearmNextResponse with office-hours math when a customer message arms a
 * cycle — and hides it once that cycle settled, so the chip stops counting a
 * clock the teammate already answered. Old stamps (no nextResponseDueAt yet)
 * simply show no next-response clock until the next customer message arms one.
 */
export function slaDtoFor(conversation: Conversation): ConversationSlaDTO | null {
  const stamp = conversation.slaApplied as SlaApplied | null
  if (!stamp) return null
  return {
    policyId: stamp.policyId,
    policyName: stamp.policyName,
    appliedAt: stamp.appliedAt,
    firstResponseDueAt: stamp.firstResponseDueAt,
    firstResponseAt: stamp.firstResponseAt ?? null,
    nextResponseDueAt: stamp.nextResponseAt ? null : (stamp.nextResponseDueAt ?? null),
    timeToCloseDueAt: stamp.timeToCloseDueAt,
    resolvedAt: stamp.resolvedAt ?? null,
    pauseOnSnooze: stamp.pauseOnSnooze ?? true,
  }
}

/** The nearest unmet SLA deadline for the 'sla' sort's keyset cursor — the JS
 *  twin of `slaDueExpr` (the two MUST agree or pages dupe/skip). */
export function slaDueAtFor(conversation: Conversation): Date | null {
  const dto = slaDtoFor(conversation)
  return dto ? (nextSlaDue(dto)?.dueAt ?? null) : null
}

/**
 * Project a conversation row's P2-D.1 inbox-translation columns into the
 * client DTO shape. Defined here (rather than in
 * conversation-translation.service.ts) so that service can import
 * `conversationToDTO` from this module without a circular import —
 * conversation-translation.service.ts re-exports this for convenience.
 */
export function translationStateFrom(conversation: Conversation): ConversationTranslationStateDTO {
  return {
    enabled: conversation.translationEnabled ?? false,
    detectedCustomerLanguage: conversation.detectedCustomerLanguage ?? null,
    suggestionDismissed: conversation.translationDismissedAt != null,
  }
}

export function toConversationDTO(
  conversation: Conversation,
  visitor: ConversationAuthorDTO,
  assignedAgent: ConversationAuthorDTO | null,
  unreadCount: number,
  // Agent-only field; callers pass null on visitor-facing paths.
  visitorEmail: string | null = null,
  // Conversation labels (agent-only); empty when untagged.
  tags: ConversationTagDTO[] = [],
  // The end-conversation note (agent-only); callers pass null on visitor paths.
  endNote: string | null = null,
  // Snooze wake time (agent-only); callers pass null on visitor paths.
  snoozedUntil: string | null = null,
  assignedTeamId: string | null = null,
  // Active-SLA clocks (agent-only); callers pass null on visitor paths.
  sla: ConversationSlaDTO | null = null,
  // Custom attribute values (agent-only); callers pass {} on visitor paths.
  // jsonb is JSON-safe by construction, hence the serializable value type.
  customAttributes: Record<string, JsonValue> = {},
  // Two-way inbox translation state (agent-only); callers pass null on
  // visitor paths — the widget has no UI for this feature.
  translation: ConversationTranslationStateDTO | null = null
): ConversationDTO {
  return {
    id: conversation.id,
    status: conversation.status,
    priority: conversation.priority,
    channel: conversation.channel,
    subject: conversation.subject,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
    visitor,
    assignedAgent,
    unreadCount,
    visitorLastReadAt: conversation.visitorLastReadAt?.toISOString() ?? null,
    agentLastReadAt: conversation.agentLastReadAt?.toISOString() ?? null,
    csatRating: conversation.csatRating ?? null,
    visitorEmail,
    resolvedAt: conversation.resolvedAt?.toISOString() ?? null,
    // The reason is shown on both sides (so a closed thread displays its
    // outcome); the free-text note is agent-only. The column is plain text but
    // the app constrains writes to the taxonomy, so the cast is safe.
    endReason: (conversation.endReason as ConversationEndReason | null) ?? null,
    endNote,
    snoozedUntil,
    assignedTeamId,
    tags,
    sla,
    customAttributes,
    translation,
  }
}

/**
 * Batch-load conversation labels for many conversations at once (one query),
 * keyed by conversation id. Soft-deleted tags are excluded. Empty input → empty
 * map (no query).
 */
export async function loadConversationTagsForConversations(
  conversationIds: ConversationId[]
): Promise<Map<ConversationId, ConversationTagDTO[]>> {
  const map = new Map<ConversationId, ConversationTagDTO[]>()
  if (conversationIds.length === 0) return map
  const rows = await db
    .select({
      conversationId: conversationTagAssignments.conversationId,
      id: conversationTags.id,
      name: conversationTags.name,
      color: conversationTags.color,
    })
    .from(conversationTagAssignments)
    .innerJoin(
      conversationTags,
      eq(conversationTagAssignments.conversationTagId, conversationTags.id)
    )
    .where(
      and(
        inArray(conversationTagAssignments.conversationId, conversationIds),
        isNull(conversationTags.deletedAt)
      )
    )
    .orderBy(asc(conversationTags.name))
  for (const r of rows) {
    const list = map.get(r.conversationId) ?? []
    list.push({ id: r.id, name: r.name, color: r.color })
    map.set(r.conversationId, list)
  }
  return map
}

/** Count messages on the other side that arrived after this side last read. */
async function unreadCountFor(
  conversation: Conversation,
  side: MessageSenderType
): Promise<number> {
  const otherSide: MessageSenderType = side === 'agent' ? 'visitor' : 'agent'
  const readAt = side === 'agent' ? conversation.agentLastReadAt : conversation.visitorLastReadAt
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversation.id),
        eq(conversationMessages.senderType, otherSide),
        isNull(conversationMessages.deletedAt),
        // Internal notes never count toward unread (esp. for the visitor side).
        eq(conversationMessages.isInternal, false),
        // Use the gt() operator (not a raw sql template) so the Date watermark
        // is bound through Drizzle's timestamp encoder — embedding a Date in a
        // raw sql fragment makes the driver reject it ("expected string, got
        // Date") and aborts the whole send.
        readAt ? gt(conversationMessages.createdAt, readAt) : undefined
      )
    )
  return row?.c ?? 0
}

/** Build a single conversation DTO with author info + unread count for a side. */
export async function conversationToDTO(
  conversation: Conversation,
  side: MessageSenderType
): Promise<ConversationDTO> {
  // Independent queries (principal info, message count, labels) run
  // concurrently; this is on the send hot path for every message. Labels are
  // agent-only, so the visitor-facing path skips the load entirely.
  const [authors, unread, tagMap] = await Promise.all([
    loadAuthors([conversation.visitorPrincipalId, conversation.assignedAgentPrincipalId]),
    unreadCountFor(conversation, side),
    side === 'agent'
      ? loadConversationTagsForConversations([conversation.id])
      : Promise.resolve(new Map<ConversationId, ConversationTagDTO[]>()),
  ])
  return toConversationDTO(
    conversation,
    authors.get(conversation.visitorPrincipalId) ?? fallbackAuthor(conversation.visitorPrincipalId),
    conversation.assignedAgentPrincipalId
      ? (authors.get(conversation.assignedAgentPrincipalId) ??
          fallbackAuthor(conversation.assignedAgentPrincipalId))
      : null,
    unread,
    side === 'agent' ? (conversation.visitorEmail ?? null) : null,
    tagMap.get(conversation.id) ?? [],
    side === 'agent' ? (conversation.endNote ?? null) : null,
    side === 'agent' ? (conversation.snoozedUntil?.toISOString() ?? null) : null,
    side === 'agent' ? (conversation.assignedTeamId ?? null) : null,
    side === 'agent' ? slaDtoFor(conversation) : null,
    side === 'agent' ? ((conversation.customAttributes ?? {}) as Record<string, JsonValue>) : {},
    side === 'agent' ? translationStateFrom(conversation) : null
  )
}

/** The visitor's most-recent conversation, if any (so the widget can resume). */
export interface ActiveConversationResult {
  conversation: Conversation | null
  /** True when the surfaced thread is closed. The widget keeps the composer and
   *  hints that replying reopens the conversation. */
  isReadOnly: boolean
}

// Statuses a returning visitor can still reply to. A 'snoozed' thread is only
// deferred on the team's side — the customer can always reply (which wakes it),
// so they can resume. Only 'closed' is read-only.
const RESUMABLE_STATUSES: ReadonlySet<string> = new Set(['open', 'snoozed'])

/**
 * Pick the conversation to surface to a returning visitor from their recent
 * threads (passed most-recent-first). A resumable thread always wins, even over
 * a more-recent closed one; if only closed threads exist, the most-recent is
 * shown read-only so the widget can offer "start a new conversation".
 */
export function selectActiveConversation(rows: Conversation[]): ActiveConversationResult {
  const resumable = rows.find((r) => RESUMABLE_STATUSES.has(r.status))
  if (resumable) return { conversation: resumable, isReadOnly: false }
  return { conversation: rows[0] ?? null, isReadOnly: rows.length > 0 }
}

export interface LinkedPostSummary {
  postId: PostId
  title: string
  boardSlug: string
}

/** Posts this conversation was converted into (conversation.convert writes the link). */
export async function getLinkedPostsForConversation(
  conversationId: ConversationId
): Promise<LinkedPostSummary[]> {
  const rows = await db
    .select({ postId: posts.id, title: posts.title, boardSlug: boards.slug })
    .from(postExternalLinks)
    .innerJoin(posts, eq(postExternalLinks.postId, posts.id))
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(
      and(
        eq(postExternalLinks.integrationType, 'live_chat'),
        eq(postExternalLinks.externalId, conversationId),
        eq(postExternalLinks.status, 'active'),
        isNull(posts.deletedAt)
      )
    )
  return rows.map((r) => ({ postId: r.postId as PostId, title: r.title, boardSlug: r.boardSlug }))
}

export interface LinkedConversationSummary {
  conversationId: ConversationId
  subject: string | null
  status: ConversationStatus
}

/** Conversations linked to a post (the other direction of conversation.convert). */
export async function getLinkedConversationsForPost(
  postId: PostId
): Promise<LinkedConversationSummary[]> {
  const rows = await db
    .select({
      conversationId: conversations.id,
      subject: conversations.subject,
      status: conversations.status,
    })
    .from(postExternalLinks)
    // Deliberately NO innerJoin(integrations): a 'live_chat' link has a null
    // integrationId, so joining integrations would silently drop every conversation
    // link. The externalId IS the conversation id for these rows.
    .innerJoin(conversations, eq(postExternalLinks.externalId, conversations.id))
    .where(
      and(
        eq(postExternalLinks.postId, postId),
        eq(postExternalLinks.integrationType, 'live_chat'),
        eq(postExternalLinks.status, 'active')
      )
    )
  return rows.map((r) => ({
    conversationId: r.conversationId as ConversationId,
    subject: r.subject,
    status: r.status,
  }))
}

export async function getActiveConversationForVisitor(
  visitorPrincipalId: PrincipalId
): Promise<ActiveConversationResult> {
  // Fetch a small recent window (not just LIMIT 1) so an older still-open thread
  // can win over a more-recent closed one.
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.visitorPrincipalId, visitorPrincipalId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(10)
  return selectActiveConversation(rows)
}

/**
 * View result for a specific conversation a visitor asked for (history row /
 * ?c= deep link). Returns no conversation when the row is missing or not owned
 * by this visitor — existence is hidden, matching canViewConversation. A closed
 * thread is surfaced read-only, exactly like the active-conversation path.
 */
export function resolveVisitorConversation(
  row: Conversation | null,
  visitorPrincipalId: PrincipalId
): ActiveConversationResult {
  if (!row || row.visitorPrincipalId !== visitorPrincipalId) {
    return { conversation: null, isReadOnly: false }
  }
  return { conversation: row, isReadOnly: !RESUMABLE_STATUSES.has(row.status) }
}

/** Load one conversation by id, scoped to its owning visitor (see resolveVisitorConversation). */
export async function getConversationForVisitor(
  conversationId: ConversationId,
  visitorPrincipalId: PrincipalId
): Promise<ActiveConversationResult> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  return resolveVisitorConversation(row ?? null, visitorPrincipalId)
}

/**
 * All of a visitor's conversations, newest-first. `side` controls the DTO
 * audience: 'agent' for the admin user profile (default), 'visitor' for the
 * visitor browsing their own history in the widget (drops agent-only fields).
 */
export async function listConversationsForVisitor(
  visitorPrincipalId: PrincipalId,
  limit = 50,
  side: MessageSenderType = 'agent'
): Promise<ConversationDTO[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.visitorPrincipalId, visitorPrincipalId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit)
  // Small N per user, so per-row DTO building is fine.
  return Promise.all(rows.map((c) => conversationToDTO(c, side)))
}

/**
 * Total unread across ALL of a visitor's conversations — the aggregate the
 * messenger launcher/tab badge needs (`conversationToDTO`'s per-thread
 * `unreadCount` only covers one conversation, so a badge built from the
 * most-recent thread silently misses unread replies in older ones). One query:
 * agent messages newer than each conversation's visitor read watermark, summed.
 * A never-read conversation (null watermark) counts all its agent messages,
 * mirroring `unreadCountFor`; internal notes and deleted rows never count.
 */
export async function countVisitorUnreadMessages(visitorPrincipalId: PrincipalId): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(conversationMessages)
    .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.visitorPrincipalId, visitorPrincipalId),
        eq(conversationMessages.senderType, 'agent'),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt),
        or(
          isNull(conversations.visitorLastReadAt),
          gt(conversationMessages.createdAt, conversations.visitorLastReadAt)
        )
      )
    )
  return row?.c ?? 0
}

export interface MessagePage {
  messages: ConversationMessageDTO[]
  hasMore: boolean
  /** Cursor for the next (older) page — the oldest message id returned. */
  nextCursor: string | null
  /** Agent-only post suggestions carried on internal notes, keyed by message id,
   *  built in-memory from the rows this page already loaded (no extra query). It
   *  is consumed by `enrichMessagesForAgent` and MUST NOT be serialized to a
   *  client response — the suggestion is agent-only. Empty whenever internal
   *  notes aren't loaded (every visitor path). */
  postSuggestions: Map<ConversationMessageId, PostSuggestion>
  /** Agent-only pending-action pointers carried on internal notes, keyed by
   *  message id — the same in-memory idiom as `postSuggestions` (no extra
   *  query). Consumed by `enrichMessagesForAgent`; MUST NOT be serialized to a
   *  client response. Empty whenever internal notes aren't loaded. */
  pendingActionPointers: Map<ConversationMessageId, AssistantPendingActionSurface>
  /** Agent-only (P2-D.1 inbox translation): the pre-translation original of
   *  an OUTGOING message sent while translation was active, keyed by message
   *  id — the same in-memory idiom as `postSuggestions`. Populated for every
   *  message (not just internal notes) since a translated reply is an
   *  ordinary agent message. Consumed by `enrichMessagesForAgent`; MUST NOT
   *  be serialized to a client response. */
  translatedFromPointers: Map<ConversationMessageId, TranslatedFromMetadata>
}

/**
 * Resolve a message-id cursor to its (created_at, id) keyset anchor, scoped to
 * the conversation: a cursor from another conversation must not be honored —
 * it could truncate a page or shift a reconnect-backfill window. Shared by
 * listMessages (`before`) and the SSE stream's Last-Event-ID backfill.
 */
export async function findBackfillCursor(
  conversationId: ConversationId,
  messageId: string
): Promise<{ createdAt: Date; id: ConversationMessage['id'] } | null> {
  const [row] = await db
    .select({ createdAt: conversationMessages.createdAt, id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, messageId as ConversationMessage['id']),
        eq(conversationMessages.conversationId, conversationId)
      )
    )
    .limit(1)
  return row ?? null
}

// ---------------------------------------------------------------------------
// Convergence Phase 0 — pair thread (scratchpad/convergence-design.md,
// mechanics appendix "Read (Phase 0)"). pair-thread.service.ts (tickets
// domain) is the canonical ticket-side union loader; the two helpers below
// are the conversation-side twins, kept schema-local here (the same
// cross-table read idiom as inbox.query.ts's loadLinkedCustomerTicketSummaries)
// so conversation.query keeps no import edge into the tickets domain.
// ---------------------------------------------------------------------------

/**
 * The CUSTOMER ticket linked to a conversation, or null. At most one can
 * exist (0150's partial unique index; 0214's makes the pair 1:1).
 */
async function resolvePairTicketId(conversationId: ConversationId): Promise<TicketId | null> {
  const [link] = await db
    .select({ ticketId: ticketConversations.ticketId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.conversationId, conversationId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  return link?.ticketId ?? null
}

/**
 * Resolve a message-id cursor to its (created_at, id) anchor WITHOUT scoping
 * to the conversation: with a linked pair, the oldest row of a merged page
 * (the next `before`) can be a legacy TICKET-parented row, which
 * findBackfillCursor's conversation scope would silently drop (restarting the
 * page at the newest). Either parent's id anchors both — the single-cursor
 * contract pair-thread.service's MERGE CONTRACT note documents.
 */
async function findPairCursor(
  messageId: string
): Promise<{ createdAt: Date; id: ConversationMessage['id'] } | null> {
  const [row] = await db
    .select({ createdAt: conversationMessages.createdAt, id: conversationMessages.id })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId as ConversationMessage['id']))
    .limit(1)
  return row ?? null
}

/**
 * The pair merge contract's total order, newest-first — (created_at DESC, id
 * DESC), identical to pair-thread.service's comparator. Both parents are
 * conversation_messages rows (one id sequence space), so the JS string
 * tiebreak matches SQL's `id DESC`.
 */
function compareMessagesNewestFirst(a: ConversationMessage, b: ConversationMessage): number {
  const t = b.createdAt.getTime() - a.createdAt.getTime()
  if (t !== 0) return t
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0
}

/**
 * List messages in a conversation, newest-first internally for keyset
 * pagination, returned oldest-first for rendering. `before` is a message id
 * cursor (fetch messages older than it).
 *
 * CONVERGENCE PHASE 0: agent surfaces pass `includeLinkedTicket` so a linked
 * CUSTOMER ticket's legacy ticket-parented rows render inline — one shared
 * thread per pair (the agent conversation view of a pair; the ticket-side
 * twin is pair-thread.service.ts's loader, and the merge contract is the
 * same). The ticket parent's page is fetched with the same (created_at, id)
 * keyset against its own index and merged in code; the audience rule
 * (`includeInternal`) applies to both parents alike. The flag unset (every
 * visitor/grounding/realtime path) or no linked ticket degenerates to the
 * pre-convergence conversation-only read, byte-identical.
 */
// The assistant's service principal is a workspace singleton; the memoized id
// resolver lives in messages/assistant-principal (shared with the pair-thread
// union loader) so message loads can flag Quinn's turns (`isAssistant`)
// without a per-load lookup.
export async function listMessages(
  conversationId: ConversationId,
  opts?: {
    before?: string
    limit?: number
    includeInternal?: boolean
    includeLinkedTicket?: boolean
  }
): Promise<MessagePage> {
  const limit = Math.min(opts?.limit ?? MESSAGE_PAGE_SIZE, 100)

  const linkedTicketId = opts?.includeLinkedTicket
    ? await resolvePairTicketId(conversationId)
    : null

  // Composite keyset cursor on (created_at, id): two messages can share a
  // microsecond timestamp (e.g. same-transaction or concurrent sends), so a
  // strict created_at comparison would silently skip same-timestamp siblings.
  // With a linked pair the anchor can be a ticket-parented row, so it resolves
  // unscoped (findPairCursor).
  const cursor = opts?.before
    ? linkedTicketId
      ? await findPairCursor(opts.before)
      : await findBackfillCursor(conversationId, opts.before)
    : null

  const rows = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNull(conversationMessages.deletedAt),
        // Visitors never see internal notes; agents pass includeInternal.
        opts?.includeInternal ? undefined : eq(conversationMessages.isInternal, false),
        cursor
          ? or(
              lt(conversationMessages.createdAt, cursor.createdAt),
              and(
                eq(conversationMessages.createdAt, cursor.createdAt),
                lt(conversationMessages.id, cursor.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
    .limit(limit + 1)

  // The pair union's second parent: the linked ticket's legacy rows, fetched
  // with the same keyset/audience against the ticket-parent index, then merged
  // in code (see the doc comment above).
  const ticketRows = linkedTicketId
    ? await db
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.ticketId, linkedTicketId),
            isNull(conversationMessages.deletedAt),
            opts?.includeInternal ? undefined : eq(conversationMessages.isInternal, false),
            cursor
              ? or(
                  lt(conversationMessages.createdAt, cursor.createdAt),
                  and(
                    eq(conversationMessages.createdAt, cursor.createdAt),
                    lt(conversationMessages.id, cursor.id)
                  )
                )
              : undefined
          )
        )
        .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
        .limit(limit + 1)
    : []
  const merged =
    ticketRows.length > 0 ? [...rows, ...ticketRows].sort(compareMessagesNewestFirst) : rows

  // Each parent was fetched with limit+1, so merged overflow is exactly "more
  // rows exist" (the pair merge contract — cut rows re-emerge on the next
  // page below the cursor anchor).
  const hasMore = merged.length > limit
  const page = hasMore ? merged.slice(0, limit) : merged
  const [authors, assistantPrincipalId] = await Promise.all([
    loadAuthors(page.map((m) => m.principalId)),
    assistantPrincipalIdOnce(),
  ])
  const ordered = [...page].reverse() // oldest-first for rendering
  // Stash the agent-only suggestion off each internal note's metadata while we
  // still have the raw rows, so the agent enrichment can attach it without a
  // second `SELECT metadata` round-trip. `toMessageDTO` forwards ordinary
  // client-safe metadata (e.g. `block`/`blockReply`, Phase C's conversational
  // block layer) but still never exposes these agent-only extras
  // (postSuggestion, assistantPendingAction, translatedFrom) — this map is
  // their only carrier, and it never leaves the server.
  const postSuggestions = new Map<ConversationMessageId, PostSuggestion>()
  const pendingActionPointers = new Map<ConversationMessageId, AssistantPendingActionSurface>()
  const translatedFromPointers = new Map<ConversationMessageId, TranslatedFromMetadata>()
  for (const m of page) {
    const suggestion = m.metadata?.postSuggestion
    if (m.isInternal && suggestion) postSuggestions.set(m.id, suggestion)
    const pendingAction = m.metadata?.assistantPendingAction
    if (m.isInternal && pendingAction) pendingActionPointers.set(m.id, pendingAction)
    // Not internal-note-gated (unlike the two above): a translated reply is
    // an ordinary agent message, not a note.
    const translatedFrom = m.metadata?.translatedFrom
    if (translatedFrom) translatedFromPointers.set(m.id, translatedFrom)
  }
  return {
    messages: ordered.map((m) =>
      // System events have a null principal and therefore no author.
      toMessageDTO(
        m,
        m.principalId ? (authors.get(m.principalId) ?? fallbackAuthor(m.principalId)) : null,
        assistantPrincipalId
      )
    ),
    hasMore,
    nextCursor: page.length > 0 ? page[page.length - 1].id : null,
    postSuggestions,
    pendingActionPointers,
    translatedFromPointers,
  }
}

/**
 * Load a conversation's ENTIRE thread (oldest-first, no page window) as message
 * DTOs, for the copilot grounding block (`loadConversationGroundingContext`).
 * Grounding must see the thread head as well as its tail: the windowed
 * `listMessages` read returns only the newest page (capped at 100), which would
 * silently drop the customer's original request on a long conversation. The
 * shared `budgetTranscript` trims the rendered result by chars, so this
 * unbounded row read is bounded downstream. `includeInternal` gates agent-only
 * notes exactly as `listMessages` does; soft-deleted rows are excluded. This
 * lean read carries none of `listMessages`'s metadata-map enrichment (post
 * suggestions, pending actions), which grounding does not use.
 */
export async function listConversationMessagesForGrounding(
  conversationId: ConversationId,
  opts?: { includeInternal?: boolean }
): Promise<ConversationMessageDTO[]> {
  const rows = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNull(conversationMessages.deletedAt),
        opts?.includeInternal ? undefined : eq(conversationMessages.isInternal, false)
      )
    )
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))

  const [authors, assistantPrincipalId] = await Promise.all([
    loadAuthors(rows.map((m) => m.principalId)),
    assistantPrincipalIdOnce(),
  ])
  return rows.map((m) =>
    toMessageDTO(
      m,
      m.principalId ? (authors.get(m.principalId) ?? fallbackAuthor(m.principalId)) : null,
      assistantPrincipalId
    )
  )
}

export interface ConversationListFilter {
  status?: ConversationStatus
  /** Inbound source discriminator ('widget' today; email/others join later).
   *  Plumbing for channel/source nav scopes — the column is plain text. */
  source?: string
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  assignedAgentPrincipalId?: PrincipalId
  /** Unassigned queue: only conversations with no assigned agent. */
  unassignedOnly?: boolean
  /** Free-text match over the visitor name + message content. */
  search?: string
  /** Filter to conversations carrying ANY of these labels (OR semantics). */
  tagIds?: ConversationTagId[]
  /** Filter to conversations whose visitor is a member of ANY of these segments
   *  (OR semantics). Exclusive-scope today sends a single id, but the array keeps
   *  it symmetric with tagIds. */
  segmentIds?: SegmentId[]
  /** Restrict to conversations whose visitor principal belongs to this company. */
  companyId?: CompanyId
  /** Per-team inbox: conversations assigned to this team. Applied via a raw
   *  `assigned_team_id` predicate so the read stays decoupled from the sibling
   *  team-assignment schema change; only set once teams exist. */
  teamId?: TeamId
  /** "Waiting" scope: only conversations a customer is currently waiting on
   *  (waiting_since IS NOT NULL). */
  waitingOnly?: boolean
  /** Restrict to a single visitor's conversations (the admin user profile). */
  visitorPrincipalId?: PrincipalId
  /** "Mentions" view: only conversations whose internal notes @-mention this
   *  principal. Always the requesting agent — resolved server-side from auth,
   *  never client-supplied (it would leak who-mentioned-whom). */
  mentionedPrincipalId?: PrincipalId
  /** "Quinn AI" view: only conversations with an `assistant_involvements` row in
   *  ANY of these lifecycle statuses (Resolved / Escalated / Pending buckets). */
  assistantStatuses?: AssistantInvolvementStatus[]
  /** Custom-attribute view rules (§C2.7): every entry ANDs an additional
   *  predicate against `custom_attributes`. See `attributeFilterCondition`. */
  attributeFilters?: ConversationAttributeFilterParam[]
  /** CONVERGENCE PHASE 2 (alias semantics): restrict to conversations that ARE
   *  a pair — i.e. carry an active `ticket_conversations` link to a (non-
   *  deleted) customer ticket. Set by the Tickets-section inbox scopes
   *  ("Customer"/"All tickets"), where a linked pair lists as its ONE item —
   *  the conversation row wearing the ticket chip — alongside any still-
   *  standalone ticket rows from the ticket branch. Never set by the plain
   *  conversation scopes (their rows are unrestricted). */
  hasLinkedCustomerTicket?: boolean
  /** Inbox ordering (default 'recent'). Keyset pagination adapts per sort. */
  sort?: ConversationSort
  /** Cursor: the previous page's last conversation id, re-resolved per sort. */
  before?: string
  limit?: number
}

/**
 * The ordering contract for each sort, as pure data (column + direction +
 * null handling). The query builder derives its ORDER BY and keyset cursor
 * comparison from this, so the two can never diverge — and it is directly
 * unit-testable without a database.
 */
export interface SortDescriptor {
  primary: 'lastMessageAt' | 'createdAt' | 'waitingSince' | 'priorityRank' | 'slaDueAt'
  direction: 'asc' | 'desc'
}

export function sortDescriptorFor(sort: ConversationSort = 'recent'): SortDescriptor {
  switch (sort) {
    case 'oldest':
      return { primary: 'lastMessageAt', direction: 'asc' }
    case 'created':
      return { primary: 'createdAt', direction: 'desc' }
    case 'waiting':
      return { primary: 'waitingSince', direction: 'asc' }
    case 'priority':
      return { primary: 'priorityRank', direction: 'desc' }
    case 'sla':
      return { primary: 'slaDueAt', direction: 'asc' }
    case 'recent':
    default:
      return { primary: 'lastMessageAt', direction: 'desc' }
  }
}

const priorityRankExpr = priorityRankSql(conversations.priority)

/**
 * Nearest unmet SLA deadline for the 'sla' sort — the SQL twin of
 * `slaDueAtFor` (keep the arms in lockstep). LEAST ignores NULL arms, so a
 * settled or untracked clock simply drops out; no applied SLA (or nothing
 * unmet) yields NULL and sorts last. The next-response arm reads the stamp's
 * own armed deadline (nextResponseDueAt), mirroring the DTO.
 */
const slaDueExpr = sql`LEAST(
  CASE WHEN ${conversations.slaApplied} ->> 'firstResponseAt' IS NULL
       THEN (${conversations.slaApplied} ->> 'firstResponseDueAt')::timestamptz END,
  CASE WHEN ${conversations.slaApplied} ->> 'nextResponseAt' IS NULL
       THEN (${conversations.slaApplied} ->> 'nextResponseDueAt')::timestamptz END,
  CASE WHEN ${conversations.slaApplied} ->> 'resolvedAt' IS NULL
       THEN (${conversations.slaApplied} ->> 'timeToCloseDueAt')::timestamptz END
)`

/** ORDER BY clause list for a sort. `id` breaks ties so keyset never dupes/skips. */
function orderByForSort(sort: ConversationSort) {
  const d = sortDescriptorFor(sort)
  const idTie = d.direction === 'asc' ? asc(conversations.id) : desc(conversations.id)
  switch (d.primary) {
    case 'priorityRank':
      // Highest priority first, then most-recent activity, then id. No
      // functional index backs the CASE rank: it intentionally full-sorts,
      // bounded by inbox size (the result set is already status/team-scoped).
      return [desc(priorityRankExpr), desc(conversations.lastMessageAt), desc(conversations.id)]
    case 'waitingSince':
      // Longest-waiting first; nobody-waiting (NULL) rows sit at the end.
      return [sql`${conversations.waitingSince} ASC NULLS LAST`, asc(conversations.id)]
    case 'slaDueAt':
      // Soonest breach first; rows with no active SLA clock sit at the end.
      return [sql`${slaDueExpr} ASC NULLS LAST`, asc(conversations.id)]
    case 'createdAt':
      return [
        d.direction === 'asc' ? asc(conversations.createdAt) : desc(conversations.createdAt),
        idTie,
      ]
    case 'lastMessageAt':
    default:
      return [
        d.direction === 'asc'
          ? asc(conversations.lastMessageAt)
          : desc(conversations.lastMessageAt),
        idTie,
      ]
  }
}

/**
 * Keyset cursor comparison for a sort: rows strictly after the cursor row in
 * the sort's order, assembled by the shared `buildKeysetCondition` (a
 * generic OR-of-ANDs "lexicographic successor" builder — see
 * `lib/server/db/keyset.ts`) from this sort's per-column `equal`/`strict`
 * pair, most-significant-first. The cursor is re-resolved from the DB (never
 * a client string) so ties + sub-ms precision are exact. Covers every sort,
 * including the waiting/SLA NULLS-LAST boundary and the priority-rank CASE.
 */
function cursorConditionForSort(sort: ConversationSort, c: Conversation) {
  const d = sortDescriptorFor(sort)
  switch (d.primary) {
    case 'priorityRank': {
      const rank = PRIORITY_RANK[c.priority] ?? 1
      const rankCol: KeysetColumn = {
        equal: eq(priorityRankExpr, rank),
        strict: lt(priorityRankExpr, rank),
      }
      return buildKeysetCondition([
        rankCol,
        descColumn(conversations.lastMessageAt, c.lastMessageAt),
        descColumn(conversations.id, c.id),
      ])
    }
    case 'waitingSince': {
      // waiting_since ASC NULLS LAST, id ASC. A cursor already in the NULL tail
      // only precedes later NULL rows (by id) — nothing sorts "more null", so
      // this column contributes no `strict` of its own. Otherwise later
      // non-NULL rows OR the entire NULL tail (NULLS LAST sorts every null row
      // after every non-null one), then the id tiebreak.
      const waitingCol: KeysetColumn = c.waitingSince
        ? {
            equal: eq(conversations.waitingSince, c.waitingSince),
            strict: or(
              gt(conversations.waitingSince, c.waitingSince),
              isNull(conversations.waitingSince)
            )!,
          }
        : { equal: isNull(conversations.waitingSince), strict: undefined }
      return buildKeysetCondition([waitingCol, ascColumn(conversations.id, c.id)])
    }
    case 'slaDueAt': {
      // slaDueExpr ASC NULLS LAST, id ASC — same NULLS-LAST boundary shape as
      // the waiting sort, with the cursor's due derived by the JS twin. The
      // ISO string is bound (not a Date) and cast, matching the timestamptz
      // the expression yields.
      const due = slaDueAtFor(c)
      const slaCol: KeysetColumn = due
        ? {
            equal: sql`${slaDueExpr} = ${due.toISOString()}::timestamptz`,
            strict: or(
              sql`${slaDueExpr} > ${due.toISOString()}::timestamptz`,
              sql`${slaDueExpr} IS NULL`
            )!,
          }
        : { equal: sql`${slaDueExpr} IS NULL`, strict: undefined }
      return buildKeysetCondition([slaCol, ascColumn(conversations.id, c.id)])
    }
    case 'createdAt': {
      const col =
        d.direction === 'asc'
          ? ascColumn(conversations.createdAt, c.createdAt)
          : descColumn(conversations.createdAt, c.createdAt)
      const idTie =
        d.direction === 'asc'
          ? ascColumn(conversations.id, c.id)
          : descColumn(conversations.id, c.id)
      return buildKeysetCondition([col, idTie])
    }
    case 'lastMessageAt':
    default: {
      const col =
        d.direction === 'asc'
          ? ascColumn(conversations.lastMessageAt, c.lastMessageAt)
          : descColumn(conversations.lastMessageAt, c.lastMessageAt)
      const idTie =
        d.direction === 'asc'
          ? ascColumn(conversations.id, c.id)
          : descColumn(conversations.id, c.id)
      return buildKeysetCondition([col, idTie])
    }
  }
}

// ---------------------------------------------------------------------------
// Custom-attribute view filters (§C2.7 / AI-ATTRIBUTES-PARITY-SPEC.md Phase 4):
// translate a `{ key, operator, value }` rule into a jsonb predicate over
// `conversations.custom_attributes`. Every stored entry is either the
// `{ v, src, at }` envelope (see lib/shared/conversation/attribute-values.ts)
// or a bare legacy value — this unwraps both to the same "effective value"
// expression the operators compare against, mirroring `readAttributeValue`'s
// envelope detection (an object carrying a 'v' key is always an envelope;
// none of the value types an attribute can hold — string/number/bool/array —
// is itself a JSON object, so the check is unambiguous).
// ---------------------------------------------------------------------------

/** The jsonb value at `custom_attributes -> key`, envelope-unwrapped. */
function attributeValueExpr(key: string) {
  return sql`(CASE
    WHEN jsonb_typeof(${conversations.customAttributes} -> ${key}) = 'object'
         AND (${conversations.customAttributes} -> ${key}) ? 'v'
    THEN ${conversations.customAttributes} -> ${key} -> 'v'
    ELSE ${conversations.customAttributes} -> ${key}
  END)`
}

/** True when the effective value counts as "set" — mirrors
 *  `attributeHasValue`: not null/undefined, not '', not []. */
function attributeIsSetExpr(key: string) {
  const v = attributeValueExpr(key)
  return sql`(${v} IS NOT NULL AND ${v} <> 'null'::jsonb AND ${v} <> '""'::jsonb AND ${v} <> '[]'::jsonb)`
}

/**
 * Build the jsonb predicate for one attribute view rule, or `undefined` when
 * the operator/value combination is degenerate (no value on a value-required
 * operator, an empty includes_any/excludes_all set) — an omitted predicate
 * matches everything rather than erroring, same as the other list filters
 * silently no-op on an empty array (see the tagIds/segmentIds guards above).
 * Every bound value goes through a parameter (`${...}` in the sql template),
 * never string-interpolated, so a hostile key/value can't break out of the
 * jsonb operand.
 */
export function attributeFilterCondition(
  key: string,
  operator: ConversationAttributeOperator,
  value: string | number | boolean | string[] | undefined
) {
  const v = attributeValueExpr(key)
  switch (operator) {
    case 'is_set':
      return attributeIsSetExpr(key)
    case 'is_empty':
      return sql`NOT ${attributeIsSetExpr(key)}`
    case 'eq':
      if (value === undefined) return undefined
      return sql`${v} = ${JSON.stringify(value)}::jsonb`
    case 'neq':
      if (value === undefined) return undefined
      return sql`(${v} IS DISTINCT FROM ${JSON.stringify(value)}::jsonb)`
    case 'contains':
    case 'not_contains': {
      if (typeof value !== 'string' || value === '') return undefined
      // Guard the NULL case explicitly (unset attribute): `NOT (NULL ILIKE …)`
      // is SQL NULL (excluded either way), but the workflow evaluator treats
      // an unset value as "doesn't contain" — so not_contains must still
      // match it. text IS NOT NULL AND … / its negation keeps both arms
      // consistent with `applyOp`'s contains/not_contains in
      // condition.evaluator.ts.
      const text = sql`(${v} #>> '{}')`
      const matches = sql`(${text} IS NOT NULL AND ${text} ILIKE ${'%' + value + '%'})`
      return operator === 'contains' ? matches : sql`NOT (${matches})`
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof value !== 'number') return undefined
      const cast = sql`(${v} #>> '{}')::numeric`
      switch (operator) {
        case 'gt':
          return sql`${cast} > ${value}`
        case 'gte':
          return sql`${cast} >= ${value}`
        case 'lt':
          return sql`${cast} < ${value}`
        case 'lte':
          return sql`${cast} <= ${value}`
      }
      break
    }
    case 'includes_any':
    case 'excludes_all': {
      const values = Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : []
      if (values.length === 0) return undefined
      // jsonb_array_elements_text unnests the stored option-id array so a
      // plain IN-list (parameter-bound, same idiom as company_attr's 'in'
      // operator in segment.evaluation.ts) can match against it.
      const placeholders = sql.join(
        values.map((val) => sql`${val}`),
        sql`, `
      )
      const anyMatch = sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(${v}, '[]'::jsonb)) elem
        WHERE elem IN (${placeholders})
      )`
      return operator === 'includes_any' ? anyMatch : sql`NOT (${anyMatch})`
    }
    default:
      return undefined
  }
}

export interface ConversationListPage {
  conversations: ConversationDTO[]
  hasMore: boolean
  nextCursor: string | null
}

/**
 * Inbox feed for agents: conversations newest-activity-first with unread
 * counts, scoped by `conversationFilter(actor)` (UNIFIED-INBOX-SPEC.md §6 —
 * wiring this is a deliberate behavior change: a bare `conversation.view`
 * holder now sees assigned-to-me-or-my-team only, matching tickets, rather
 * than every conversation).
 */
export async function listConversationsForAgent(
  filter: ConversationListFilter = {},
  actor: Actor
): Promise<ConversationListPage> {
  const limit = Math.min(filter.limit ?? INBOX_PAGE_SIZE, 100)
  const sort = filter.sort ?? 'recent'
  // Keyset cursor = the previous page's last conversation id. Re-read the exact
  // row from the DB rather than trusting a client-supplied string, so the sort's
  // ordering columns (which vary per sort) + ties are handled deterministically
  // (mirrors listMessages). An unknown id → first page, and a malformed cursor
  // can no longer reach a date parse / 500 the list.
  let cursor: Conversation | null = null
  if (filter.before) {
    const [row] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, filter.before as ConversationId))
      .limit(1)
    if (row) cursor = row
  }
  const search = filter.search?.trim()
  // Match the visitor's name or any non-deleted message content. EXISTS keeps
  // the select shape (conversations only) — no join row fan-out. The term is
  // parameter-bound, so `%`/`_` are treated as literals-plus-wildcards, not SQLi.
  const searchCondition = search
    ? sql`(
          EXISTS (
            SELECT 1 FROM ${principal} p
            WHERE p.id = ${conversations.visitorPrincipalId}
              AND p.display_name ILIKE ${'%' + search + '%'}
          )
          OR EXISTS (
            SELECT 1 FROM ${conversationMessages} m
            WHERE m.conversation_id = ${conversations.id}
              AND m.deleted_at IS NULL
              AND m.content ILIKE ${'%' + search + '%'}
          )
        )`
    : undefined

  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        conversationFilter(actor),
        filter.status ? eq(conversations.status, filter.status) : undefined,
        filter.source ? eq(conversations.source, filter.source) : undefined,
        filter.visitorPrincipalId
          ? eq(conversations.visitorPrincipalId, filter.visitorPrincipalId)
          : undefined,
        filter.priority ? eq(conversations.priority, filter.priority) : undefined,
        filter.assignedAgentPrincipalId
          ? eq(conversations.assignedAgentPrincipalId, filter.assignedAgentPrincipalId)
          : undefined,
        filter.unassignedOnly ? isNull(conversations.assignedAgentPrincipalId) : undefined,
        // Per-team inbox. A raw predicate on assigned_team_id keeps this read
        // decoupled from the sibling team-assignment schema change; only set
        // once teams exist, so the default inbox never touches the column.
        filter.teamId
          ? sql`${conversations}.assigned_team_id = ${toUuid(filter.teamId)}`
          : undefined,
        // "Waiting" scope: a customer is currently waiting on a reply.
        filter.waitingOnly ? isNotNull(conversations.waitingSince) : undefined,
        searchCondition,
        // Label filter: conversations carrying ANY of the selected labels. A
        // DISTINCT subquery keeps the select shape (conversations only).
        filter.tagIds && filter.tagIds.length > 0
          ? inArray(
              conversations.id,
              db
                .selectDistinct({ id: conversationTagAssignments.conversationId })
                .from(conversationTagAssignments)
                .innerJoin(
                  conversationTags,
                  eq(conversationTagAssignments.conversationTagId, conversationTags.id)
                )
                .where(
                  and(
                    inArray(conversationTagAssignments.conversationTagId, filter.tagIds),
                    isNull(conversationTags.deletedAt)
                  )
                )
            )
          : undefined,
        // Segment filter: conversations whose visitor (the principal who opened
        // the conversation) is a member of ANY of the selected segments. Mirrors
        // the post/user inbox pattern (post.inbox.ts) — a subquery over
        // user_segments keeps the outer select shape (conversations only).
        filter.segmentIds && filter.segmentIds.length > 0
          ? inArray(
              conversations.visitorPrincipalId,
              db
                .select({ principalId: userSegments.principalId })
                .from(userSegments)
                .innerJoin(segments, eq(userSegments.segmentId, segments.id))
                .where(
                  and(
                    inArray(userSegments.segmentId, filter.segmentIds),
                    // Exclude soft-deleted segments — mirrors the tag filter's
                    // deleted-tag guard so a stale `?segment=` to a removed
                    // segment can't still match conversations.
                    isNull(segments.deletedAt)
                  )
                )
            )
          : undefined,
        // Company filter: conversations whose visitor principal belongs to the
        // given company. A subquery over principal (served by
        // principal_company_id_idx) keeps the outer select shape (conversations
        // only) — same idiom as the segment filter above.
        filter.companyId
          ? inArray(
              conversations.visitorPrincipalId,
              db
                .select({ id: principal.id })
                .from(principal)
                .where(eq(principal.companyId, filter.companyId))
            )
          : undefined,
        // Mentions view: conversations carrying an internal note that @-mentions
        // this principal. A DISTINCT subquery over conversation_message_mentions →
        // conversation_messages keeps the outer select shape (conversations only). Guard
        // on deleted_at IS NULL — mention rows outlive a note's soft-delete (the
        // FK only cascades on hard delete) — and isInternal as defense-in-depth.
        filter.mentionedPrincipalId
          ? inArray(
              conversations.id,
              db
                .selectDistinct({ id: conversationMessages.conversationId })
                .from(conversationMessageMentions)
                .innerJoin(
                  conversationMessages,
                  eq(conversationMessageMentions.conversationMessageId, conversationMessages.id)
                )
                .where(
                  and(
                    eq(conversationMessageMentions.principalId, filter.mentionedPrincipalId),
                    isNull(conversationMessages.deletedAt),
                    eq(conversationMessages.isInternal, true)
                  )
                )
            )
          : undefined,
        // Quinn AI view: restrict to conversations Quinn engaged whose involvement
        // is in one of the requested lifecycle buckets. Distinct subquery keeps the
        // outer select shape (conversations only), like the mentions predicate.
        filter.assistantStatuses && filter.assistantStatuses.length > 0
          ? inArray(
              conversations.id,
              db
                .selectDistinct({ id: assistantInvolvements.conversationId })
                .from(assistantInvolvements)
                .where(inArray(assistantInvolvements.status, filter.assistantStatuses))
            )
          : undefined,
        // Custom-attribute view rules (§C2.7): each ANDs its own jsonb
        // predicate — spread so an arbitrary number of rules compose without
        // nesting another `and(...)` level.
        ...(filter.attributeFilters ?? []).map((f) =>
          attributeFilterCondition(f.key, f.operator, f.value)
        ),
        // Convergence alias semantics (the Tickets-section scopes): only
        // conversations carrying an active customer-ticket link. EXISTS keeps
        // the select shape (conversations only); the tickets join excludes a
        // link pointing at a soft-deleted ticket so a deleted ticket's pair
        // can't keep listing.
        filter.hasLinkedCustomerTicket
          ? sql`EXISTS (
              SELECT 1 FROM ${ticketConversations} tc
              INNER JOIN ${tickets} t ON t.id = tc.ticket_id AND t.deleted_at IS NULL
              WHERE tc.conversation_id = ${conversations.id}
                AND tc.ticket_type = 'customer'
            )`
          : undefined,
        // Keyset comparison for the active sort (re-resolved cursor row). id is
        // always the final tiebreak so a page boundary never dupes or skips.
        cursor ? cursorConditionForSort(sort, cursor) : undefined
      )
    )
    .orderBy(...orderByForSort(sort))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  if (page.length === 0) {
    return { conversations: [], hasMore: false, nextCursor: null }
  }

  // Authors for all visitors + assigned agents in one batch.
  const authors = await loadAuthors(
    page.flatMap((c) => [c.visitorPrincipalId, c.assignedAgentPrincipalId])
  )

  // Unread (visitor-authored, after the agent's last read) for all rows, batched.
  const ids = page.map((c) => c.id)
  const unreadRows = await db
    .select({
      conversationId: conversationMessages.conversationId,
      c: sql<number>`count(*)::int`,
    })
    .from(conversationMessages)
    .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
    .where(
      and(
        inArray(conversationMessages.conversationId, ids),
        eq(conversationMessages.senderType, 'visitor'),
        isNull(conversationMessages.deletedAt),
        // Internal notes never count toward unread — defense-in-depth mirroring
        // unreadCountFor (visitor messages are never internal, but keep it explicit).
        eq(conversationMessages.isInternal, false),
        or(
          isNull(conversations.agentLastReadAt),
          sql`${conversationMessages.createdAt} > ${conversations.agentLastReadAt}`
        )
      )
    )
    .groupBy(conversationMessages.conversationId)
  const unreadMap = new Map<string, number>()
  // The inner join on conversations guarantees a non-null conversation_id.
  for (const row of unreadRows) unreadMap.set(row.conversationId!, row.c)

  // Labels for all rows, batched (one query). Inbox is agent-only.
  const tagMap = await loadConversationTagsForConversations(ids)

  return {
    conversations: page.map((c) =>
      toConversationDTO(
        c,
        authors.get(c.visitorPrincipalId) ?? fallbackAuthor(c.visitorPrincipalId),
        c.assignedAgentPrincipalId
          ? (authors.get(c.assignedAgentPrincipalId) ?? fallbackAuthor(c.assignedAgentPrincipalId))
          : null,
        unreadMap.get(c.id) ?? 0,
        c.visitorEmail ?? null,
        tagMap.get(c.id) ?? [],
        c.endNote ?? null,
        c.snoozedUntil?.toISOString() ?? null,
        c.assignedTeamId ?? null,
        slaDtoFor(c),
        // customAttributes intentionally omitted here (unchanged pre-existing
        // behavior for the inbox list) — the caller's default (`{}`) applies.
        undefined,
        translationStateFrom(c)
      )
    ),
    hasMore,
    // Opaque keyset cursor: the last conversation id, re-resolved on the next call.
    nextCursor: page[page.length - 1].id,
  }
}
