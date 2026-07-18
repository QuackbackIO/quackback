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
import {
  db,
  conversationMessages,
  tickets,
  eq,
  and,
  lt,
  or,
  asc,
  desc,
  isNull,
  type Ticket,
  type ConversationSystemEventKind,
} from '@/lib/server/db'
import type { TicketId, ConversationMessageId, PrincipalId } from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { ConversationAttachment, TiptapContent } from '@/lib/shared/db-types'
import type {
  ConversationMessageDTO,
  AgentConversationMessageDTO,
} from '@/lib/shared/conversation/types'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import {
  validateAttachments,
  validateContent,
  richMessageFallbackLabel,
  resolveMessageContent,
  toMessageDTO,
} from '@/lib/server/messages/message-core'
import { loadAuthors, fallbackAuthor } from '../principals/principal-display'
// The conversation domain, not this one, owns reaction/flag storage
// (conversationMessageReactions/Flags) — `enrichMessagesForAgent` is already
// generic over any ConversationMessageDTO[] + viewer id, so the agent-view
// ticket read path (listTicketMessagesForAgent, below) reuses it rather than
// re-querying those tables here. Safe to import statically: conversation.query.ts
// has no import edge back into this domain (verified — no cycle).
import { enrichMessagesForAgent } from '../conversation/conversation.query'
import { firstResponseStamp } from './ticket.lifecycle'
import { loadTicketOr404 } from './ticket.service'
import { emitTicketReplied, emitTicketNoteAdded } from './ticket.webhooks'
import { safeSubscribeToTicket } from './ticket-subscription.service'
import { publishTicketEvent } from '@/lib/server/realtime/conversation-channels'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError } from '@/lib/shared/errors'

const MESSAGE_PAGE_SIZE = 30

/**
 * Insert a team-only, author-less 'system' status event on a ticket thread —
 * the ticket-side counterpart of the conversation domain's `emitSystemMessage`
 * (conversation.service.ts): `senderType: 'system'`, no principal,
 * `metadata.systemEvent` carrying `kind` plus whatever else the caller passes.
 * Always internal — there is no ticket-side customer-facing announcement
 * surface yet (a deliberate gap; see `linkTicketToTracker`'s doc comment in
 * ticket-links.service.ts), so every ticket system event today is team-only.
 *
 * Takes an `exec` Executor (defaulting to `db`) so a caller already inside a
 * `db.transaction` — `linkTicketToTracker`'s link + audit note — can enlist
 * this insert in the same transaction instead of committing it separately.
 * Unlike `emitSystemMessage` this does not publish or swallow errors: the
 * caller decides whether a failure here should be fatal (as it is for the
 * tracker-link transaction) or best-effort.
 *
 * `dedupeKey` makes the insert idempotent for redelivered inbound webhooks:
 * it lands as top-level `metadata.inboundDeliveryKey`, guarded by the partial
 * unique index on (ticket_id, metadata->>'inboundDeliveryKey'), and a
 * conflicting insert is a no-op. Returns whether a row was actually inserted
 * so callers can gate follow-on side effects (the watcher bell) on it —
 * mirroring the email path's emailMessageId idiom.
 */
export async function emitTicketSystemMessage(
  ticketId: TicketId,
  kind: ConversationSystemEventKind,
  body: string,
  opts?: { metadata?: Record<string, unknown>; exec?: Executor; dedupeKey?: string }
): Promise<boolean> {
  const exec = opts?.exec ?? db
  const rows = await exec
    .insert(conversationMessages)
    .values({
      ticketId,
      principalId: null,
      senderType: 'system',
      isInternal: true,
      content: body,
      metadata: {
        systemEvent: { kind, ...opts?.metadata },
        ...(opts?.dedupeKey ? { inboundDeliveryKey: opts.dedupeKey } : {}),
      },
    })
    .onConflictDoNothing()
    .returning({ id: conversationMessages.id })
  return rows.length > 0
}

export interface SendTicketMessageInput {
  ticketId: TicketId
  content: string
  contentJson?: TiptapContent | null
  attachments?: ConversationAttachment[]
  /** Provenance/dedup metadata carried onto the stored row. The reply-by-email
   *  path stamps `{ source: 'email', emailMessageId }` so a redelivered inbound
   *  message is caught by the (metadata->>'emailMessageId') partial unique index
   *  the conversation path already relies on; the portal reply path omits it. */
  metadata?: Record<string, unknown>
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
 *
 * Returns the loaded ticket alongside the message so a caller can fire the
 * matching webhook event without a second read; its ref fields (number, type,
 * priority, assignment) are unchanged by the message write.
 */
export async function insertTicketMessage(
  input: SendTicketMessageInput,
  principalId: PrincipalId,
  opts: InsertTicketMessageOpts
): Promise<{ message: ConversationMessageDTO; ticket: Ticket }> {
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

  const messageRow = await db.transaction(async (tx) => {
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
        metadata: input.metadata ?? undefined,
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
  const message = toMessageDTO(messageRow, author)
  // Realtime signal (unified inbox §3.2, M3): the one low-level write shared
  // by the agent reply, the internal note, AND the requester reply (see
  // sendTicketMessage / addTicketNote / requester.service's replyToMyTicket),
  // so one publish call here covers all three. Safe to publish an internal
  // note on both the ticket + inbox channels unstripped — both audiences are
  // team-member-only in this phase (routes/api/chat/stream.ts's `ticketId`
  // scope gate), unlike the conversation domain's visitor-facing channel.
  publishTicketEvent(input.ticketId, { kind: 'ticket_message', ticketId: input.ticketId, message })
  return { message, ticket: existing }
}

/** Agent reply on a customer ticket thread (customer-visible). */
export async function sendTicketMessage(
  actor: Actor,
  input: SendTicketMessageInput
): Promise<{ message: ConversationMessageDTO }> {
  assertCan(actor, PERMISSIONS.TICKET_REPLY, 'reply to this ticket')
  const principalId = requireAgentPrincipal(actor)
  const { message, ticket } = await insertTicketMessage(input, principalId, {
    senderType: 'agent',
    isInternal: false,
    stampFirstResponse: true,
  })
  // Replying opts the agent in as a watcher (reason 'replier'). Must never
  // fail the send itself; note authors and visitor replies subscribe nobody.
  await safeSubscribeToTicket(principalId, input.ticketId, 'replier')
  // Agent/integration-facing signal, fire-and-forget after the write commits.
  void emitTicketReplied(actor, ticket, message)
  return { message }
}

/** Agent-only internal note on a ticket thread (never customer-visible). */
export async function addTicketNote(
  actor: Actor,
  input: SendTicketMessageInput
): Promise<{ message: ConversationMessageDTO }> {
  assertCan(actor, PERMISSIONS.TICKET_NOTE, 'add a note to this ticket')
  const principalId = requireAgentPrincipal(actor)
  const { message, ticket } = await insertTicketMessage(input, principalId, {
    senderType: 'agent',
    isInternal: true,
    stampFirstResponse: false,
  })
  void emitTicketNoteAdded(actor, ticket, message)
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
 *
 * `all: true` returns the ENTIRE ordered thread (oldest-first, no page window,
 * no cursor), for callers that need the thread head as well as its tail — the
 * copilot grounding loader (`loadTicketGroundingContext`), which must never drop
 * the original request on a long thread the way the default newest-page window
 * silently would. Every other caller (the inbox pager, the requester portal, the
 * transcript export, the Summarize chip) omits it and keeps the byte-identical
 * newest-`MESSAGE_PAGE_SIZE` page behavior.
 */
export async function listTicketMessages(
  ticketId: TicketId,
  opts: { before?: string; includeInternal?: boolean; all?: boolean } = {}
): Promise<TicketMessagePage> {
  if (opts.all) {
    const rows = await db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.ticketId, ticketId),
          isNull(conversationMessages.deletedAt),
          opts.includeInternal ? undefined : eq(conversationMessages.isInternal, false)
        )
      )
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))

    const authors = await loadAuthors(rows.map((m) => m.principalId))
    const messages = rows.map((m) =>
      toMessageDTO(
        m,
        m.principalId ? (authors.get(m.principalId) ?? fallbackAuthor(m.principalId)) : null
      )
    )
    return { messages, hasMore: false }
  }

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

export interface AgentTicketMessagePage {
  messages: AgentConversationMessageDTO[]
  hasMore: boolean
}

/**
 * Agent-view page of a ticket's thread: `listTicketMessages` plus the same
 * reactions/flags enrichment the conversation inbox already applies via
 * `enrichMessagesForAgent` (unified inbox §2.5 — ticket messages now carry
 * reactions/flags too, see message.actions.ts). A sibling function rather
 * than a parameter on `listTicketMessages` because that fn's return type
 * (`TicketMessagePage`, bare `ConversationMessageDTO[]`) is also used by the
 * requester portal and the transcript export, neither of which may ever see
 * agent-only reaction/flag data — keeping them as two functions makes that
 * split a type-level guarantee instead of a runtime opt.  Quinn post-
 * suggestions and pending-action pointers don't exist on ticket threads yet,
 * hence the empty map.
 */
export async function listTicketMessagesForAgent(
  ticketId: TicketId,
  viewerPrincipalId: PrincipalId,
  opts: { before?: string; includeInternal?: boolean } = {}
): Promise<AgentTicketMessagePage> {
  const page = await listTicketMessages(ticketId, opts)
  const messages = await enrichMessagesForAgent(page.messages, viewerPrincipalId, new Map())
  return { messages, hasMore: page.hasMore }
}
