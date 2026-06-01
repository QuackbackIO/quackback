/**
 * Read-side queries + DTO mappers for live chat. Keyset pagination on
 * (created_at, id); chat is flat, so no comment-tree reconstruction.
 */
import {
  db,
  conversations,
  conversationTags,
  conversationWatchers,
  chatMessages,
  principal,
  user,
  tags,
  eq,
  and,
  or,
  lt,
  gt,
  inArray,
  isNull,
  desc,
  sql,
  posts,
  boards,
  postExternalLinks,
  type Conversation,
  type ChatMessage,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId, PostId } from '@quackback/ids'
import type {
  ChatAuthorDTO,
  ChatMessageDTO,
  ChatTagDTO,
  ConversationDTO,
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
  const rows = await db
    .select({
      id: principal.id,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
    })
    .from(principal)
    .where(inArray(principal.id, unique))
  for (const row of rows) {
    map.set(row.id, {
      principalId: row.id,
      displayName: row.displayName ?? null,
      avatarUrl: row.avatarUrl ?? null,
    })
  }
  return map
}

export function fallbackAuthor(principalId: PrincipalId): ChatAuthorDTO {
  return { principalId, displayName: null, avatarUrl: null }
}

export interface ChatWatcher {
  principalId: PrincipalId
  email: string | null
  name: string | null
  avatarUrl: string | null
}

/** Team members watching a conversation (with contact info for notification). */
export async function getWatchersForConversation(
  conversationId: ConversationId
): Promise<ChatWatcher[]> {
  const rows = await db
    .select({
      principalId: conversationWatchers.principalId,
      email: user.email,
      name: user.name,
      avatarUrl: principal.avatarUrl,
    })
    .from(conversationWatchers)
    .innerJoin(principal, eq(conversationWatchers.principalId, principal.id))
    .leftJoin(user, eq(principal.userId, user.id))
    .where(eq(conversationWatchers.conversationId, conversationId))
    .orderBy(user.name)
  return rows.map((r) => ({
    principalId: r.principalId as PrincipalId,
    email: r.email ?? null,
    name: r.name ?? null,
    avatarUrl: r.avatarUrl ?? null,
  }))
}

/** Batch-load conversation tags (agent-only triage metadata), grouped by id. */
export async function loadTagsForConversations(
  ids: ReadonlyArray<ConversationId>
): Promise<Map<string, ChatTagDTO[]>> {
  const map = new Map<string, ChatTagDTO[]>()
  if (ids.length === 0) return map
  const rows = await db
    .select({
      conversationId: conversationTags.conversationId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    })
    .from(conversationTags)
    .innerJoin(tags, eq(tags.id, conversationTags.tagId))
    .where(and(inArray(conversationTags.conversationId, [...ids]), isNull(tags.deletedAt)))
    .orderBy(tags.name)
  for (const r of rows) {
    const list = map.get(r.conversationId) ?? []
    list.push({ id: r.id, name: r.name, color: r.color })
    map.set(r.conversationId, list)
  }
  return map
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

export function toMessageDTO(message: ChatMessage, author: ChatAuthorDTO): ChatMessageDTO {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderType: message.senderType as ChatSenderType,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    author,
    attachments: message.attachments ?? [],
    isInternal: message.isInternal,
  }
}

export function toConversationDTO(
  conversation: Conversation,
  visitor: ChatAuthorDTO,
  assignedAgent: ChatAuthorDTO | null,
  unreadCount: number,
  // Agent-only field; callers pass null on visitor-facing paths.
  visitorEmail: string | null = null,
  // Agent-only triage tags; callers pass [] on visitor-facing paths.
  tagList: ChatTagDTO[] = []
): ConversationDTO {
  return {
    id: conversation.id,
    status: conversation.status,
    priority: conversation.priority,
    channel: conversation.channel,
    tags: tagList,
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
  }
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
  // Independent queries (principal info vs message count vs tags) — run
  // concurrently; this runs on the send hot path for every message. Tags are
  // agent-only triage metadata, so only load them on the agent side.
  const [authors, unread, tagMap] = await Promise.all([
    loadAuthors([conversation.visitorPrincipalId, conversation.assignedAgentPrincipalId]),
    unreadCountFor(conversation, side),
    side === 'agent'
      ? loadTagsForConversations([conversation.id])
      : Promise.resolve(new Map<string, ChatTagDTO[]>()),
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
// customer, so they can resume; 'snoozed' is an agent-side defer the visitor
// is unaware of (a reply un-defers it). Only 'closed' is read-only.
const RESUMABLE_STATUSES: ReadonlySet<string> = new Set(['open', 'snoozed', 'pending'])

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
      toMessageDTO(m, authors.get(m.principalId) ?? fallbackAuthor(m.principalId))
    ),
    hasMore,
    nextCursor: page.length > 0 ? page[page.length - 1].id : null,
  }
}

export interface ConversationListFilter {
  status?: 'open' | 'snoozed' | 'pending' | 'closed'
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  assignedAgentPrincipalId?: PrincipalId
  /** Free-text match over the visitor name + message content. */
  search?: string
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
  const beforeDate = filter.before ? new Date(filter.before) : null
  const search = filter.search?.trim()
  // Match the visitor's name or any non-deleted message content. EXISTS keeps
  // the select shape (conversations only) — no join row fan-out. The term is
  // parameter-bound, so `%`/`_` are treated as literals-plus-wildcards, not SQLi.
  const searchCondition =
    search && search.length > 0
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
        searchCondition,
        beforeDate ? lt(conversations.lastMessageAt, beforeDate) : undefined
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
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
        or(
          isNull(conversations.agentLastReadAt),
          sql`${chatMessages.createdAt} > ${conversations.agentLastReadAt}`
        )
      )
    )
    .groupBy(chatMessages.conversationId)
  const unreadMap = new Map<string, number>()
  for (const row of unreadRows) unreadMap.set(row.conversationId, row.c)

  // Tags for the whole page in one grouped query (inbox is agent-only).
  const tagMap = await loadTagsForConversations(ids)

  return {
    conversations: page.map((c) =>
      toConversationDTO(
        c,
        authors.get(c.visitorPrincipalId) ?? fallbackAuthor(c.visitorPrincipalId),
        c.assignedAgentPrincipalId
          ? (authors.get(c.assignedAgentPrincipalId) ?? fallbackAuthor(c.assignedAgentPrincipalId))
          : null,
        unreadMap.get(c.id) ?? 0,
        // Inbox is agent-only.
        c.visitorEmail ?? null,
        tagMap.get(c.id) ?? []
      )
    ),
    hasMore,
    nextCursor: page.length > 0 ? page[page.length - 1].lastMessageAt.toISOString() : null,
  }
}
