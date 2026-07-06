/**
 * Ticket thread messages (support platform §4.2). A `customer` ticket is a
 * repliable two-way thread that reuses the polymorphic conversation_messages
 * table (a row with `ticket_id` set instead of `conversation_id`, since 0151).
 * The write path mirrors the conversation agent-reply but with a far lighter
 * denormalization: a ticket carries no last-message columns, so an agent reply
 * only stamps `first_response_at` (once) and bumps `updated_at`.
 *
 * 7C.1 is the agent side (reply + internal note + list). Requester replies, the
 * public_stage-change notification path, and live SSE arrive with later slices.
 */
import { db, conversationMessages, tickets, eq, and, lt, or, desc, isNull } from '@/lib/server/db'
import type { TicketId, ConversationMessageId, PrincipalId } from '@quackback/ids'
import type { ConversationAttachment, TiptapContent } from '@/lib/shared/db-types'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import {
  validateAttachments,
  validateContent,
  richMessageFallbackLabel,
  resolveMessageContent,
  toMessageDTO,
} from '@/lib/server/messages/message-core'
import { loadAuthors, fallbackAuthor } from '../principals/principal-display'
import { firstResponseStamp } from './ticket.lifecycle'
import { loadTicketOr404 } from './ticket.service'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError } from '@/lib/shared/errors'

const MESSAGE_PAGE_SIZE = 30

export interface SendTicketMessageInput {
  ticketId: TicketId
  content: string
  contentJson?: TiptapContent | null
  attachments?: ConversationAttachment[]
}

function assertCan(actor: Actor, permission: PermissionKey, action: string): void {
  if (!can(actor, permission)) throw new ForbiddenError('FORBIDDEN', `You cannot ${action}`)
}

/** Resolve the acting agent's principal id or refuse — a ticket message always
 *  carries an author (unlike a system event). */
function requireAgentPrincipal(actor: Actor): PrincipalId {
  if (!actor.principalId) throw new ForbiddenError('FORBIDDEN', 'You must be signed in')
  return actor.principalId
}

interface InsertTicketMessageOpts {
  senderType: 'agent' | 'visitor'
  isInternal: boolean
  /** Stamp first_response_at (once) — true only for an agent reply. */
  stampFirstResponse: boolean
}

/**
 * Low-level ticket-message write, shared by the agent reply/note paths and the
 * requester reply path. The CALLER owns authorization (agent permission vs
 * requester ownership); this only validates, inserts, and lightly denormalizes.
 */
export async function insertTicketMessage(
  input: SendTicketMessageInput,
  principalId: PrincipalId,
  opts: InsertTicketMessageOpts
): Promise<ConversationMessageDTO> {
  const attachments = validateAttachments(input.attachments)
  const safeContentJson = input.contentJson
    ? sanitizeTiptapContent(input.contentJson, {
        // Requester-authored inline images may only reference our own storage.
        restrictImagesToTrustedOrigins: opts.senderType === 'visitor',
      })
    : null
  const fallbackLabel = richMessageFallbackLabel(safeContentJson)
  const content = validateContent(
    resolveMessageContent(input.content, safeContentJson),
    attachments.length > 0 || !!fallbackLabel
  )

  // Validate existence + read first_response_at before the write; the stamp is
  // idempotent (set once), so a read-before-update race is harmless.
  const existing = await loadTicketOr404(input.ticketId)

  const message = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(conversationMessages)
      .values({
        ticketId: input.ticketId,
        principalId,
        senderType: opts.senderType,
        content,
        contentJson: safeContentJson,
        isInternal: opts.isInternal,
        attachments: attachments.length > 0 ? attachments : null,
      })
      .returning()

    await tx
      .update(tickets)
      .set({
        // Only an agent reply is a "first response"; a note or a requester reply is not.
        firstResponseAt: opts.stampFirstResponse
          ? firstResponseStamp(existing.firstResponseAt, true, row.createdAt)
          : undefined,
        updatedAt: row.createdAt,
      })
      .where(eq(tickets.id, input.ticketId))

    return row
  })

  const author = (await loadAuthors([principalId])).get(principalId) ?? fallbackAuthor(principalId)
  return toMessageDTO(message, author)
}

/** Agent reply on a customer ticket thread (customer-visible). */
export async function sendTicketMessage(
  actor: Actor,
  input: SendTicketMessageInput
): Promise<{ message: ConversationMessageDTO }> {
  assertCan(actor, PERMISSIONS.TICKET_REPLY, 'reply to this ticket')
  const principalId = requireAgentPrincipal(actor)
  const message = await insertTicketMessage(input, principalId, {
    senderType: 'agent',
    isInternal: false,
    stampFirstResponse: true,
  })
  return { message }
}

/** Agent-only internal note on a ticket thread (never customer-visible). */
export async function addTicketNote(
  actor: Actor,
  input: SendTicketMessageInput
): Promise<{ message: ConversationMessageDTO }> {
  assertCan(actor, PERMISSIONS.TICKET_NOTE, 'add a note to this ticket')
  const principalId = requireAgentPrincipal(actor)
  const message = await insertTicketMessage(input, principalId, {
    senderType: 'agent',
    isInternal: true,
    stampFirstResponse: false,
  })
  return { message }
}

export interface TicketMessagePage {
  messages: ConversationMessageDTO[]
  hasMore: boolean
}

/**
 * A page of a ticket's thread, newest-loaded last (keyset on createdAt,id before
 * the cursor). `includeInternal` gates agent-only notes; a requester view passes
 * false. Soft-deleted messages are excluded.
 */
export async function listTicketMessages(
  ticketId: TicketId,
  opts: { before?: string; includeInternal?: boolean } = {}
): Promise<TicketMessagePage> {
  const cursor = opts.before
    ? await db
        .select({ createdAt: conversationMessages.createdAt, id: conversationMessages.id })
        .from(conversationMessages)
        .where(eq(conversationMessages.id, opts.before as ConversationMessageId))
        .limit(1)
        .then((r) => r[0])
    : null

  const rows = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.ticketId, ticketId),
        isNull(conversationMessages.deletedAt),
        opts.includeInternal ? undefined : eq(conversationMessages.isInternal, false),
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
    .limit(MESSAGE_PAGE_SIZE + 1)

  const hasMore = rows.length > MESSAGE_PAGE_SIZE
  const page = hasMore ? rows.slice(0, MESSAGE_PAGE_SIZE) : rows
  // Oldest-first for rendering; the query pulled newest-first for the keyset.
  page.reverse()

  const authors = await loadAuthors(page.map((m) => m.principalId))
  const messages = page.map((m) =>
    toMessageDTO(
      m,
      m.principalId ? (authors.get(m.principalId) ?? fallbackAuthor(m.principalId)) : null
    )
  )
  return { messages, hasMore }
}
