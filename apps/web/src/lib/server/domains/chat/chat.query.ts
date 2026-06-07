/**
 * Read-side queries + DTO mappers for support-inbox conversations. Keyset pagination on
 * (created_at, id); chat is flat, so no comment-tree reconstruction.
 */
import {
  db,
  conversations,
  chatMessages,
  principal,
  user,
  eq,
  and,
  or,
  lt,
  gt,
  inArray,
  isNull,
  desc,
  asc,
  sql,
  posts,
  boards,
  postStatuses,
  postExternalLinks,
  chatTags,
  conversationTags,
  chatMessageMentions,
  chatMessageReactions,
  chatMessageFlags,
  userSegments,
  segments,
  type Conversation,
  type ChatMessage,
} from '@/lib/server/db'
import type {
  ConversationId,
  PrincipalId,
  PostId,
  BoardId,
  ChatTagId,
  ChatMessageId,
  SegmentId,
} from '@quackback/ids'
import type { ChatCard } from '@/lib/shared/db-types'
import { collectCardRefs, buildCardView } from './chat.card-view'
import type { BoardRow, PostRow } from './chat.card-view'
import { aggregateReactions } from '@/lib/shared'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { truncate } from '@/lib/shared/utils/string'
import type {
  ChatAuthorDTO,
  ChatMessageDTO,
  AgentChatMessageDTO,
  MessageReactionCount,
  FlaggedMessageDTO,
  ConversationDTO,
  ChatTagDTO,
  ChatSenderType,
  ConversationStatus,
} from '@/lib/shared/chat/types'

const MESSAGE_PAGE_SIZE = 30
const INBOX_PAGE_SIZE = 25

/** Batch-load principal display info, returning a lookup map. */
export async function loadAuthors(
  ids: ReadonlyArray<PrincipalId | null | undefined>
): Promise<Map<PrincipalId, ChatAuthorDTO>> {
  const unique = [...new Set(ids.filter((id): id is PrincipalId => !!id))]
  const map = new Map<PrincipalId, ChatAuthorDTO>()
  if (unique.length === 0) return map
  // Resolve the avatar from the linked user (the canonical source, like the
  // team-member list): an external image URL, or the public URL of an uploaded
  // avatar (stored only as an S3 key), falling back to the principal's synced
  // copy. principal.avatarUrl alone is not reliably kept in sync, so agents
  // whose avatar lives only on the user row would otherwise show initials.
  const rows = await db
    .select({
      id: principal.id,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
      userImage: user.image,
      userImageKey: user.imageKey,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(inArray(principal.id, unique))
  for (const row of rows) {
    map.set(row.id, {
      principalId: row.id,
      displayName: row.displayName ?? null,
      avatarUrl: row.userImage ?? getPublicUrlOrNull(row.userImageKey) ?? row.avatarUrl ?? null,
    })
  }
  return map
}

export function fallbackAuthor(principalId: PrincipalId): ChatAuthorDTO {
  return { principalId, displayName: null, avatarUrl: null }
}

/** Build an author DTO from a send-call author input (no DB round trip). */
export function authorFromInput(input: {
  principalId: PrincipalId
  displayName?: string | null
  avatarUrl?: string | null
}): ChatAuthorDTO {
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
}): Promise<ChatAuthorDTO> {
  const resolved = (await loadAuthors([input.principalId])).get(input.principalId)
  if (!resolved) return authorFromInput(input)
  return {
    principalId: input.principalId,
    displayName: input.displayName ?? resolved.displayName,
    avatarUrl: resolved.avatarUrl ?? input.avatarUrl ?? null,
  }
}

export function toMessageDTO(message: ChatMessage, author: ChatAuthorDTO | null): ChatMessageDTO {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderType: message.senderType as ChatSenderType,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    author,
    attachments: message.attachments ?? [],
    isInternal: message.isInternal,
    contentJson: message.contentJson ?? null,
    viaEmail: message.metadata?.source === 'email',
    systemEvent: message.metadata?.systemEvent ?? null,
    card: message.metadata?.card ?? null,
  }
}

/** Batch-load reactions for a page of messages, aggregated per message with the
 *  viewing agent's `hasReacted`. Agent-only — never called on a visitor path. */
async function loadReactionsForMessages(
  messageIds: ChatMessageId[],
  viewerPrincipalId: PrincipalId
): Promise<Map<ChatMessageId, MessageReactionCount[]>> {
  const map = new Map<ChatMessageId, MessageReactionCount[]>()
  if (messageIds.length === 0) return map
  const rows = await db
    .select({
      chatMessageId: chatMessageReactions.chatMessageId,
      emoji: chatMessageReactions.emoji,
      principalId: chatMessageReactions.principalId,
      displayName: principal.displayName,
    })
    .from(chatMessageReactions)
    .leftJoin(principal, eq(principal.id, chatMessageReactions.principalId))
    .where(inArray(chatMessageReactions.chatMessageId, messageIds))
  const byMessage = new Map<
    ChatMessageId,
    Array<{ emoji: string; principalId: string; displayName: string | null }>
  >()
  for (const row of rows) {
    const list = byMessage.get(row.chatMessageId) ?? []
    list.push({ emoji: row.emoji, principalId: row.principalId, displayName: row.displayName })
    byMessage.set(row.chatMessageId, list)
  }
  for (const [id, list] of byMessage) {
    map.set(id, aggregateReactions(list, viewerPrincipalId))
  }
  return map
}

/** Batch-load the VIEWING agent's personal flag (flaggedAt ISO) for a page of
 *  messages — flags are per-agent ("Saved for later"). */
async function loadFlagsForMessages(
  messageIds: ChatMessageId[],
  viewerPrincipalId: PrincipalId
): Promise<Map<ChatMessageId, string>> {
  const map = new Map<ChatMessageId, string>()
  if (messageIds.length === 0) return map
  const rows = await db
    .select({
      chatMessageId: chatMessageFlags.chatMessageId,
      flaggedAt: chatMessageFlags.flaggedAt,
    })
    .from(chatMessageFlags)
    .where(
      and(
        inArray(chatMessageFlags.chatMessageId, messageIds),
        eq(chatMessageFlags.principalId, viewerPrincipalId)
      )
    )
  for (const row of rows) {
    map.set(row.chatMessageId, row.flaggedAt.toISOString())
  }
  return map
}

/** Batch-load the boards referenced by draft-post cards, keyed by id. Empty
 *  input → empty map with no query (drizzle `inArray` rejects an empty list). */
async function loadBoardsForCards(boardIds: string[]): Promise<Map<string, BoardRow>> {
  const map = new Map<string, BoardRow>()
  if (boardIds.length === 0) return map
  const rows = await db
    .select({ id: boards.id, name: boards.name, slug: boards.slug })
    .from(boards)
    .where(and(inArray(boards.id, boardIds as BoardId[]), isNull(boards.deletedAt)))
  for (const r of rows) map.set(r.id, { name: r.name, slug: r.slug })
  return map
}

/** Batch-load the posts referenced by post_ref / published draft cards, keyed by
 *  id, with their board + (workspace-customizable) status resolved via join.
 *  Empty input → empty map with no query. */
async function loadPostsForCards(postIds: string[]): Promise<Map<string, PostRow>> {
  const map = new Map<string, PostRow>()
  if (postIds.length === 0) return map
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      statusName: postStatuses.name,
      statusColor: postStatuses.color,
      boardSlug: boards.slug,
      boardName: boards.name,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .where(
      and(inArray(posts.id, postIds as PostId[]), isNull(posts.deletedAt), isNull(boards.deletedAt))
    )
  for (const r of rows) {
    map.set(r.id, {
      title: r.title,
      voteCount: r.voteCount,
      statusName: r.statusName ?? null,
      statusColor: r.statusColor ?? null,
      boardSlug: r.boardSlug,
      boardName: r.boardName,
    })
  }
  return map
}

/**
 * Attach the agent-only reaction + flag fields to a page of base message DTOs,
 * plus the display-ready `cardView` for any message carrying a card. This is the
 * ONLY place those fields are added — the shared `toMessageDTO` stays clean, so
 * no visitor-facing path can leak them (a visitor function returning
 * ChatMessageDTO[] simply never has them). Agent paths call this after
 * listMessages to upgrade to AgentChatMessageDTO[].
 */
export async function enrichMessagesForAgent(
  messages: ChatMessageDTO[],
  viewerPrincipalId: PrincipalId
): Promise<AgentChatMessageDTO[]> {
  const ids = messages.map((m) => m.id)
  // Resolve the board/post ids the page's cards reference so each card can show
  // names instead of raw ids. The loaders no-op on empty sets, so a page with no
  // cards issues no extra queries.
  const cards = messages.map((m) => m.card).filter((c): c is ChatCard => c !== null)
  const { boardIds, postIds } = collectCardRefs(cards)
  const [reactions, flags, boardMap, postMap] = await Promise.all([
    loadReactionsForMessages(ids, viewerPrincipalId),
    loadFlagsForMessages(ids, viewerPrincipalId),
    loadBoardsForCards([...boardIds]),
    loadPostsForCards([...postIds]),
  ])
  return messages.map((m) => ({
    ...m,
    reactions: reactions.get(m.id) ?? [],
    flaggedAt: flags.get(m.id) ?? null,
    cardView: m.card ? buildCardView(m.card, boardMap, postMap) : null,
  }))
}

/** Single-message agent enrichment — used to build the realtime
 *  `message_updated` payload after a reaction or flag toggle. */
export async function enrichMessageForAgent(
  message: ChatMessageDTO,
  viewerPrincipalId: PrincipalId
): Promise<AgentChatMessageDTO> {
  const [one] = await enrichMessagesForAgent([message], viewerPrincipalId)
  return one
}

/**
 * The viewing agent's "Saved for later" feed: their flagged messages, newest
 * flag first, each with a preview + the conversation it belongs to so the list
 * can link straight to it. Soft-deleted messages are skipped.
 */
export async function listFlaggedMessages(
  viewerPrincipalId: PrincipalId
): Promise<FlaggedMessageDTO[]> {
  const rows = await db
    .select({
      messageId: chatMessages.id,
      conversationId: chatMessages.conversationId,
      content: chatMessages.content,
      senderType: chatMessages.senderType,
      authorName: principal.displayName,
      visitorPrincipalId: conversations.visitorPrincipalId,
      flaggedAt: chatMessageFlags.flaggedAt,
    })
    .from(chatMessageFlags)
    .innerJoin(
      chatMessages,
      and(eq(chatMessages.id, chatMessageFlags.chatMessageId), isNull(chatMessages.deletedAt))
    )
    .innerJoin(conversations, eq(conversations.id, chatMessages.conversationId))
    .leftJoin(principal, eq(principal.id, chatMessages.principalId))
    .where(eq(chatMessageFlags.principalId, viewerPrincipalId))
    .orderBy(desc(chatMessageFlags.flaggedAt))
    .limit(100)

  const visitorNames = await loadAuthors(rows.map((r) => r.visitorPrincipalId))
  return rows.map((r) => ({
    messageId: r.messageId,
    conversationId: r.conversationId,
    preview: truncate(r.content, 120),
    authorName: r.authorName ?? (r.senderType === 'agent' ? 'Agent' : 'Visitor'),
    conversationLabel: visitorNames.get(r.visitorPrincipalId)?.displayName ?? 'Visitor',
    flaggedAt: r.flaggedAt.toISOString(),
  }))
}

export function toConversationDTO(
  conversation: Conversation,
  visitor: ChatAuthorDTO,
  assignedAgent: ChatAuthorDTO | null,
  unreadCount: number,
  // Agent-only field; callers pass null on visitor-facing paths.
  visitorEmail: string | null = null,
  // Conversation labels (agent-only); empty when untagged.
  tags: ChatTagDTO[] = []
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
    tags,
  }
}

/**
 * Batch-load conversation labels for many conversations at once (one query),
 * keyed by conversation id. Soft-deleted tags are excluded. Empty input → empty
 * map (no query).
 */
export async function loadChatTagsForConversations(
  conversationIds: ConversationId[]
): Promise<Map<ConversationId, ChatTagDTO[]>> {
  const map = new Map<ConversationId, ChatTagDTO[]>()
  if (conversationIds.length === 0) return map
  const rows = await db
    .select({
      conversationId: conversationTags.conversationId,
      id: chatTags.id,
      name: chatTags.name,
      color: chatTags.color,
    })
    .from(conversationTags)
    .innerJoin(chatTags, eq(conversationTags.chatTagId, chatTags.id))
    .where(
      and(inArray(conversationTags.conversationId, conversationIds), isNull(chatTags.deletedAt))
    )
    .orderBy(asc(chatTags.name))
  for (const r of rows) {
    const list = map.get(r.conversationId) ?? []
    list.push({ id: r.id, name: r.name, color: r.color })
    map.set(r.conversationId, list)
  }
  return map
}

/** Count messages on the other side that arrived after this side last read. */
async function unreadCountFor(conversation: Conversation, side: ChatSenderType): Promise<number> {
  const otherSide: ChatSenderType = side === 'agent' ? 'visitor' : 'agent'
  const readAt = side === 'agent' ? conversation.agentLastReadAt : conversation.visitorLastReadAt
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversationId, conversation.id),
        eq(chatMessages.senderType, otherSide),
        isNull(chatMessages.deletedAt),
        // Internal notes never count toward unread (esp. for the visitor side).
        eq(chatMessages.isInternal, false),
        // Use the gt() operator (not a raw sql template) so the Date watermark
        // is bound through Drizzle's timestamp encoder — embedding a Date in a
        // raw sql fragment makes the driver reject it ("expected string, got
        // Date") and aborts the whole send.
        readAt ? gt(chatMessages.createdAt, readAt) : undefined
      )
    )
  return row?.c ?? 0
}

/** Build a single conversation DTO with author info + unread count for a side. */
export async function conversationToDTO(
  conversation: Conversation,
  side: ChatSenderType
): Promise<ConversationDTO> {
  // Independent queries (principal info, message count, labels) run
  // concurrently; this is on the send hot path for every message. Labels are
  // agent-only, so the visitor-facing path skips the load entirely.
  const [authors, unread, tagMap] = await Promise.all([
    loadAuthors([conversation.visitorPrincipalId, conversation.assignedAgentPrincipalId]),
    unreadCountFor(conversation, side),
    side === 'agent'
      ? loadChatTagsForConversations([conversation.id])
      : Promise.resolve(new Map<ConversationId, ChatTagDTO[]>()),
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
    tagMap.get(conversation.id) ?? []
  )
}

/** The visitor's most-recent conversation, if any (so the widget can resume). */
export interface ActiveConversationResult {
  conversation: Conversation | null
  /** True when the surfaced thread is closed — the widget shows it read-only
   *  and offers to start a new conversation instead of a composer. */
  isReadOnly: boolean
}

// Statuses a returning visitor can still reply to. 'pending' = waiting on the
// customer, so they can resume. Only 'closed' is read-only.
const RESUMABLE_STATUSES: ReadonlySet<string> = new Set(['open', 'pending'])

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

/** Posts this conversation was converted into (chat.convert writes the link). */
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

/** Conversations linked to a post (the other direction of chat.convert). */
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
    // integrationId, so joining integrations would silently drop every chat
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
 * All of a visitor's conversations, newest-first. `side` controls the DTO
 * audience: 'agent' for the admin user profile (default), 'visitor' for the
 * visitor browsing their own history in the widget (drops agent-only fields).
 */
export async function listConversationsForVisitor(
  visitorPrincipalId: PrincipalId,
  limit = 50,
  side: ChatSenderType = 'agent'
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

export interface MessagePage {
  messages: ChatMessageDTO[]
  hasMore: boolean
  /** Cursor for the next (older) page — the oldest message id returned. */
  nextCursor: string | null
}

/**
 * List messages in a conversation, newest-first internally for keyset
 * pagination, returned oldest-first for rendering. `before` is a message id
 * cursor (fetch messages older than it).
 */
export async function listMessages(
  conversationId: ConversationId,
  opts?: { before?: string; limit?: number; includeInternal?: boolean }
): Promise<MessagePage> {
  const limit = Math.min(opts?.limit ?? MESSAGE_PAGE_SIZE, 100)

  // Composite keyset cursor on (created_at, id): two messages can share a
  // microsecond timestamp (e.g. same-transaction or concurrent sends), so a
  // strict created_at comparison would silently skip same-timestamp siblings.
  let cursor: { createdAt: Date; id: ChatMessage['id'] } | null = null
  if (opts?.before) {
    // Scope the cursor lookup to this conversation: a cursor from another
    // conversation must not be honored (it could truncate the page).
    const [cursorRow] = await db
      .select({ createdAt: chatMessages.createdAt, id: chatMessages.id })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.id, opts.before as ChatMessage['id']),
          eq(chatMessages.conversationId, conversationId)
        )
      )
      .limit(1)
    cursor = cursorRow ?? null
  }

  const rows = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversationId, conversationId),
        isNull(chatMessages.deletedAt),
        // Visitors never see internal notes; agents pass includeInternal.
        opts?.includeInternal ? undefined : eq(chatMessages.isInternal, false),
        cursor
          ? or(
              lt(chatMessages.createdAt, cursor.createdAt),
              and(eq(chatMessages.createdAt, cursor.createdAt), lt(chatMessages.id, cursor.id))
            )
          : undefined
      )
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const authors = await loadAuthors(page.map((m) => m.principalId))
  const ordered = [...page].reverse() // oldest-first for rendering
  return {
    messages: ordered.map((m) =>
      // System events have a null principal and therefore no author.
      toMessageDTO(
        m,
        m.principalId ? (authors.get(m.principalId) ?? fallbackAuthor(m.principalId)) : null
      )
    ),
    hasMore,
    nextCursor: page.length > 0 ? page[page.length - 1].id : null,
  }
}

export interface ConversationListFilter {
  status?: ConversationStatus
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  assignedAgentPrincipalId?: PrincipalId
  /** Unassigned queue: only conversations with no assigned agent. */
  unassignedOnly?: boolean
  /** Free-text match over the visitor name + message content. */
  search?: string
  /** Filter to conversations carrying ANY of these labels (OR semantics). */
  tagIds?: ChatTagId[]
  /** Filter to conversations whose visitor is a member of ANY of these segments
   *  (OR semantics). Exclusive-scope today sends a single id, but the array keeps
   *  it symmetric with tagIds. */
  segmentIds?: SegmentId[]
  /** "Mentions" view: only conversations whose internal notes @-mention this
   *  principal. Always the requesting agent — resolved server-side from auth,
   *  never client-supplied (it would leak who-mentioned-whom). */
  mentionedPrincipalId?: PrincipalId
  /** Cursor: lastMessageAt ISO string — fetch conversations older than it. */
  before?: string
  limit?: number
}

export interface ConversationListPage {
  conversations: ConversationDTO[]
  hasMore: boolean
  nextCursor: string | null
}

/** Inbox feed for agents: conversations newest-activity-first with unread counts. */
export async function listConversationsForAgent(
  filter: ConversationListFilter = {}
): Promise<ConversationListPage> {
  const limit = Math.min(filter.limit ?? INBOX_PAGE_SIZE, 100)
  // Keyset cursor = the previous page's last conversation id. Re-read its exact
  // (lastMessageAt, id) from the DB rather than trusting a client-supplied
  // timestamp string, so same-millisecond ties and sub-millisecond precision are
  // handled deterministically (mirrors listMessages). An unknown id → first page,
  // and a malformed cursor can no longer reach a date parse / 500 the list.
  let cursor: { at: Date; id: ConversationId } | null = null
  if (filter.before) {
    const [row] = await db
      .select({ at: conversations.lastMessageAt, id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, filter.before as ConversationId))
      .limit(1)
    if (row) cursor = { at: row.at, id: row.id }
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
            SELECT 1 FROM ${chatMessages} m
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
        filter.status ? eq(conversations.status, filter.status) : undefined,
        filter.priority ? eq(conversations.priority, filter.priority) : undefined,
        filter.assignedAgentPrincipalId
          ? eq(conversations.assignedAgentPrincipalId, filter.assignedAgentPrincipalId)
          : undefined,
        filter.unassignedOnly ? isNull(conversations.assignedAgentPrincipalId) : undefined,
        searchCondition,
        // Label filter: conversations carrying ANY of the selected labels. A
        // DISTINCT subquery keeps the select shape (conversations only).
        filter.tagIds && filter.tagIds.length > 0
          ? inArray(
              conversations.id,
              db
                .selectDistinct({ id: conversationTags.conversationId })
                .from(conversationTags)
                .innerJoin(chatTags, eq(conversationTags.chatTagId, chatTags.id))
                .where(
                  and(
                    inArray(conversationTags.chatTagId, filter.tagIds),
                    isNull(chatTags.deletedAt)
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
        // Mentions view: conversations carrying an internal note that @-mentions
        // this principal. A DISTINCT subquery over chat_message_mentions →
        // chat_messages keeps the outer select shape (conversations only). Guard
        // on deleted_at IS NULL — mention rows outlive a note's soft-delete (the
        // FK only cascades on hard delete) — and isInternal as defense-in-depth.
        filter.mentionedPrincipalId
          ? inArray(
              conversations.id,
              db
                .selectDistinct({ id: chatMessages.conversationId })
                .from(chatMessageMentions)
                .innerJoin(chatMessages, eq(chatMessageMentions.chatMessageId, chatMessages.id))
                .where(
                  and(
                    eq(chatMessageMentions.principalId, filter.mentionedPrincipalId),
                    isNull(chatMessages.deletedAt),
                    eq(chatMessages.isInternal, true)
                  )
                )
            )
          : undefined,
        cursor
          ? or(
              lt(conversations.lastMessageAt, cursor.at),
              and(eq(conversations.lastMessageAt, cursor.at), lt(conversations.id, cursor.id))
            )
          : undefined
      )
    )
    // desc(id) tiebreaker makes same-lastMessageAt ordering deterministic so the
    // composite keyset above never drops or duplicates a row at a page boundary.
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
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
      conversationId: chatMessages.conversationId,
      c: sql<number>`count(*)::int`,
    })
    .from(chatMessages)
    .innerJoin(conversations, eq(conversations.id, chatMessages.conversationId))
    .where(
      and(
        inArray(chatMessages.conversationId, ids),
        eq(chatMessages.senderType, 'visitor'),
        isNull(chatMessages.deletedAt),
        // Internal notes never count toward unread — defense-in-depth mirroring
        // unreadCountFor (visitor messages are never internal, but keep it explicit).
        eq(chatMessages.isInternal, false),
        or(
          isNull(conversations.agentLastReadAt),
          sql`${chatMessages.createdAt} > ${conversations.agentLastReadAt}`
        )
      )
    )
    .groupBy(chatMessages.conversationId)
  const unreadMap = new Map<string, number>()
  for (const row of unreadRows) unreadMap.set(row.conversationId, row.c)

  // Labels for all rows, batched (one query). Inbox is agent-only.
  const tagMap = await loadChatTagsForConversations(ids)

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
        tagMap.get(c.id) ?? []
      )
    ),
    hasMore,
    // Opaque keyset cursor: the last conversation id, re-resolved on the next call.
    nextCursor: page[page.length - 1].id,
  }
}
