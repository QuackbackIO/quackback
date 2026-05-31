/**
 * Read-side queries + DTO mappers for live chat. Keyset pagination on
 * (created_at, id); chat is flat, so no comment-tree reconstruction.
 */
import {
  db,
  conversations,
  conversationTags,
  chatMessages,
  principal,
  tags,
  eq,
  and,
  or,
  lt,
  inArray,
  isNull,
  desc,
  sql,
  type Conversation,
  type ChatMessage,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId, TagId } from '@quackback/ids'
import type {
  ChatAuthorDTO,
  ChatMessageDTO,
  ChatTagDTO,
  ConversationDTO,
  ChatSenderType,
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
  // Agent-only fields; callers pass empty/null on visitor-facing paths.
  tagList: ChatTagDTO[] = [],
  visitorEmail: string | null = null
): ConversationDTO {
  return {
    id: conversation.id,
    status: conversation.status,
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
    tags: tagList,
    visitorEmail,
  }
}

/**
 * Batch-load tags for conversations, newest tags first within each. Joins the
 * shared `tags` table and skips soft-deleted tags. Returns a lookup map.
 */
export async function loadConversationTags(
  conversationIds: ReadonlyArray<ConversationId>
): Promise<Map<ConversationId, ChatTagDTO[]>> {
  const map = new Map<ConversationId, ChatTagDTO[]>()
  const unique = [...new Set(conversationIds)]
  if (unique.length === 0) return map
  const rows = await db
    .select({
      conversationId: conversationTags.conversationId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    })
    .from(conversationTags)
    .innerJoin(tags, eq(conversationTags.tagId, tags.id))
    .where(and(inArray(conversationTags.conversationId, unique), isNull(tags.deletedAt)))
    .orderBy(tags.name)
  for (const row of rows) {
    const list = map.get(row.conversationId) ?? []
    list.push({ id: row.id, name: row.name, color: row.color })
    map.set(row.conversationId, list)
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
        readAt ? sql`${chatMessages.createdAt} > ${readAt}` : sql`true`
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
  // agent-only, so the visitor side skips that query entirely.
  const [authors, unread, tagMap] = await Promise.all([
    loadAuthors([conversation.visitorPrincipalId, conversation.assignedAgentPrincipalId]),
    unreadCountFor(conversation, side),
    side === 'agent'
      ? loadConversationTags([conversation.id])
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
    tagMap.get(conversation.id) ?? [],
    side === 'agent' ? (conversation.visitorEmail ?? null) : null
  )
}

/** The visitor's most-recent conversation, if any (so the widget can resume). */
export async function getActiveConversationForVisitor(
  visitorPrincipalId: PrincipalId
): Promise<Conversation | null> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.visitorPrincipalId, visitorPrincipalId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1)
  return row ?? null
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
  status?: 'open' | 'snoozed' | 'closed'
  assignedAgentPrincipalId?: PrincipalId
  /** Free-text match over the visitor name + message content. */
  search?: string
  /** Restrict to conversations carrying this tag. */
  tagId?: TagId
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
        filter.assignedAgentPrincipalId
          ? eq(conversations.assignedAgentPrincipalId, filter.assignedAgentPrincipalId)
          : undefined,
        filter.tagId
          ? sql`EXISTS (
              SELECT 1 FROM ${conversationTags} ct
              WHERE ct.conversation_id = ${conversations.id}
                AND ct.tag_id = ${filter.tagId}
            )`
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

  // Unread (visitor-authored, after the agent's last read) + tags for all rows,
  // both batched and run concurrently.
  const ids = page.map((c) => c.id)
  const [unreadRows, tagMap] = await Promise.all([
    db
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
      .groupBy(chatMessages.conversationId),
    loadConversationTags(ids),
  ])
  const unreadMap = new Map<string, number>()
  for (const row of unreadRows) unreadMap.set(row.conversationId, row.c)

  return {
    conversations: page.map((c) =>
      toConversationDTO(
        c,
        authors.get(c.visitorPrincipalId) ?? fallbackAuthor(c.visitorPrincipalId),
        c.assignedAgentPrincipalId
          ? (authors.get(c.assignedAgentPrincipalId) ?? fallbackAuthor(c.assignedAgentPrincipalId))
          : null,
        unreadMap.get(c.id) ?? 0,
        tagMap.get(c.id) ?? [],
        // Inbox is agent-only.
        c.visitorEmail ?? null
      )
    ),
    hasMore,
    nextCursor: page.length > 0 ? page[page.length - 1].lastMessageAt.toISOString() : null,
  }
}
