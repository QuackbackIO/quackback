/**
 * Ticket thread messages (support platform §4.2). A `customer` ticket is a
 * repliable two-way thread that reuses the polymorphic conversation_messages
 * table (a row with `ticket_id` set instead of `conversation_id`, since 0151).
 *
 * CONVERGENCE (scratchpad/convergence-design.md). A customer ticket and the
 * conversation it was created from are ONE thread. Phase 0 made the READ path
 * the pair union (`listTicketMessages` delegates to pair-thread.service.ts,
 * merging legacy ticket-parented rows with the linked conversation's
 * messages). Phase 1a — THIS module — converges the WRITE path at the
 * `insertTicketMessage` choke point. The three-path contract (mechanics
 * appendix "Write (Phase 1)"):
 *
 *   1. `insertTicketMessage` (agent reply, requester reply):
 *      - `isInternal` → stays `ticket_id`-parented (internal notes are
 *        Intercom's ticket notes — `addTicketNote` never redirects).
 *      - a CUSTOMER ticket with a linked conversation (resolved via
 *        `ticket_conversations`, ticket_type='customer') → the write lands on
 *        the CONVERSATION (`conversation_id`), running the FULL conversation
 *        write pipeline — not a bare row insert. The redirect delegates to the
 *        conversation domain's own send functions (`sendVisitorMessage` /
 *        `sendAgentMessage`, conversation.service.ts), which own
 *        `lastMessageAt`/`lastMessagePreview`, `waitingSince`, the read
 *        stamps, `emitMessageCreated` (so sla.event-hooks.ts settles FRT/NRT
 *        and resumes/re-arms on visitor messages), `publishConversationEvent`
 *        realtime, and notification dispatch. conversation.service.ts imports
 *        nothing from the tickets domain, so this delegation creates no cycle.
 *      - anything else (back-office/tracker, or a standalone customer ticket
 *        with no linked conversation — the pre-1b legacy case) → `ticket_id`
 *        as before.
 *   2. `postTicketStatusEvent` (ticket.service.ts, customer-visible stage
 *      system messages) — re-parents to the conversation on linked pairs;
 *      stays ticket-parented elsewhere.
 *   3. `emitTicketSystemMessage` (team-only internal system notes) — STAYS
 *      ticket-parented by definition; untouched by the redirect.
 *
 * Redirect invariants (all three hold whichever parent the row lands on):
 * `tickets.updatedAt` is still bumped (listMyTickets orders by it), the
 * realtime `ticket_message` still publishes on the team-only ticket channel
 * (dual-publish — the conversation channel copy is the delegate's), and the
 * ticket's `firstResponseAt` column is deliberately NOT stamped by redirected
 * agent replies: at link time `linkTicketToConversation` backfills it from the
 * conversation's first agent message, and afterwards the conversation's
 * first-response machinery owns the timeline. The caller-side `ticket.replied`
 * emission (sendTicketMessage / appendRequesterReply) fires alongside the
 * delegate's `message.created` — the notification matrix's watcher fan-out.
 *
 * PHASE 1a/1b BOUNDARY: the redirect only governs writes on already-linked
 * pairs. Phase 1b (createTicketCore's `withBackingConversation` intake path)
 * creates the backing conversation + link in the intake transaction itself
 * and writes the opening message through this module, riding the same
 * redirect — nothing in this module changes for it.
 *
 * PHASE 3 — WATERMARK STATE: the pair's unread truth is the CONVERSATION's
 * two watermarks (`conversations.agent_last_read_at` /
 * `visitor_last_read_at`), which the redirected write pipeline already
 * maintains natively (an agent reply stamps the agent side, a requester
 * reply arms `waitingSince`). The legacy `tickets.*_last_read_at` columns are
 * legacy-read only for customer tickets — nothing writes them for a linked
 * pair anymore (mark-read delegates to the conversation's mark-read;
 * mark-unread from a legacy ticket-parented anchor moves the conversation's
 * agent watermark) — and stay live only for threads that kept their own
 * ticket-scoped messages (back-office/tracker, standalone customer).
 */
import {
  db,
  conversationMessages,
  tickets,
  eq,
  type Ticket,
  type ConversationSystemEventKind,
  type ConversationMessageMetadata,
} from '@/lib/server/db'
import type { TicketId, PrincipalId, ConversationId } from '@quackback/ids'
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
import { listPairThreadMessages, resolvePairConversationId } from './pair-thread.service'
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
  /** The acting principal's policy actor, threaded through so the Phase 1a
   *  redirect can hand the conversation domain's send functions an actor to
   *  re-authorize (the caller still owns the primary authorization — an agent
   *  reply passed TICKET_REPLY, a requester reply passed ownership). Unused on
   *  the ticket-parented paths. */
  actor: Actor
}

/**
 * Low-level ticket-message write, shared by the agent reply/note paths and the
 * requester reply path. The CALLER owns authorization (agent permission vs
 * requester ownership); this only validates, inserts, and lightly denormalizes.
 *
 * CONVERGENCE PHASE 1a (see the module doc for the full three-path contract):
 * a non-internal write on a CUSTOMER ticket with a linked conversation is
 * redirected to the pair's conversation via `sendViaPairConversation` below —
 * the row lands conversation-parented and the conversation write pipeline owns
 * every side effect from there. Internal notes, back-office/tracker tickets,
 * and standalone customer tickets keep the legacy ticket-parented insert here.
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

  // THE PHASE 1a REDIRECT. The internal-note guard comes first (notes stay
  // ticket-scoped whichever parent the pair has), then the pair resolution
  // (resolvePairConversationId is itself customer-link-scoped, so a
  // back-office/tracker ticket or a standalone customer ticket falls through
  // to the legacy ticket-parented insert below).
  if (!opts.isInternal && existing.type === 'customer') {
    const pairConversationId = await resolvePairConversationId(input.ticketId)
    if (pairConversationId) {
      return sendViaPairConversation(input, principalId, opts, existing, pairConversationId, {
        content,
        contentJson: safeContentJson,
        attachments,
      })
    }
  }

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

/**
 * The Phase 1a redirect itself (the module doc carries the three-path
 * contract): land a customer-visible ticket-thread write on the pair's
 * conversation by DELEGATING to the conversation domain's own send functions —
 * `sendVisitorMessage` for a requester reply, `sendAgentMessage` for an agent
 * reply (conversation.service.ts; dynamically imported, the same precedent
 * ticket-conversation-link.service.ts sets for emitSystemMessage). This is
 * deliberately not a parent-id swap: the delegate runs the FULL conversation
 * write pipeline — `lastMessageAt`/`lastMessagePreview`, `waitingSince`
 * (a requester reply arms the NRT clock; an agent reply stops it), the read
 * stamps and status transitions, `emitMessageCreated` (sla.event-hooks.ts's
 * FRT/NRT settle/resume/re-arm rides it), the conversation-channel realtime,
 * and the notification dispatch (presence-gated requester email on an agent
 * reply — the matrix keeps it alongside the ticket-side email, no cross-channel
 * dedupe in v1). The already-validated/sanitized write inputs are threaded
 * through; the delegates' own validation passes are idempotent over them.
 *
 * Redirect invariants the delegate does NOT own (they're ticket-side):
 * `tickets.updatedAt` keeps being bumped (listMyTickets orders by it), and the
 * `ticket_message` realtime is dual-published on the team-only ticket channel
 * so agent ticket-thread views update live (the conversation-channel publish
 * is the delegate's). The ticket's `firstResponseAt` column is deliberately
 * NOT stamped: `linkTicketToConversation` backfills it at link time and the
 * conversation's first-response machinery owns the pair's timeline afterwards.
 */
async function sendViaPairConversation(
  input: SendTicketMessageInput,
  principalId: PrincipalId,
  opts: InsertTicketMessageOpts,
  ticket: Ticket,
  conversationId: ConversationId,
  prepared: {
    content: string
    contentJson: TiptapContent | null
    attachments: ConversationAttachment[]
  }
): Promise<{ message: ConversationMessageDTO; ticket: Ticket }> {
  const { sendVisitorMessage, sendAgentMessage } =
    await import('@/lib/server/domains/conversation/conversation.service')
  // ConversationAuthorDTO and ConversationAuthorInput share one shape
  // (principalId + optional displayName/avatarUrl/email), so the display
  // resolution every ticket-thread write already does doubles as the author.
  const author = (await loadAuthors([principalId])).get(principalId) ?? fallbackAuthor(principalId)
  const message =
    opts.senderType === 'visitor'
      ? (
          await sendVisitorMessage(
            {
              conversationId,
              content: prepared.content,
              attachments: prepared.attachments,
              // Provenance/dedup metadata (the reply-by-email path's
              // emailMessageId) rides along onto the conversation-parented row
              // — the metadata->>'emailMessageId' dedupe is parent-agnostic.
              metadata: input.metadata as ConversationMessageMetadata | undefined,
            },
            author,
            opts.actor,
            prepared.contentJson
          )
        ).message
      : (
          await sendAgentMessage(
            conversationId,
            prepared.content,
            author,
            opts.actor,
            prepared.attachments,
            prepared.contentJson,
            input.metadata as ConversationMessageMetadata | undefined
          )
        ).message

  await db
    .update(tickets)
    .set({ updatedAt: new Date(message.createdAt) })
    .where(eq(tickets.id, input.ticketId))
  publishTicketEvent(input.ticketId, { kind: 'ticket_message', ticketId: input.ticketId, message })
  return { message, ticket }
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
    actor,
  })
  // Replying opts the agent in as a watcher (reason 'replier'). Must never
  // fail the send itself; note authors and visitor replies subscribe nobody.
  await safeSubscribeToTicket(principalId, input.ticketId, 'replier')
  // Agent/integration-facing signal, fire-and-forget after the write commits.
  // On a linked pair this rides ALONGSIDE the delegate's `message.created`
  // (notification matrix: the watcher fan-out + the requester's always-on
  // email are ticket-side, unchanged by the redirect).
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
    actor,
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
 * CONVERGENCE PHASE 0: a customer ticket's thread IS the pair union — this
 * delegates to the pair-thread union loader (pair-thread.service.ts), which
 * merges the legacy ticket-parented messages with the linked conversation's
 * messages. A standalone or back-office/tracker ticket degenerates to the
 * pre-convergence ticket-only read (byte-identical); the `before` message-id
 * cursor and this return shape are unchanged, so every caller (the inbox
 * pager, the requester portal/widget, the transcript export, the Summarize
 * chip, MCP/API v1) wires in without a signature change. The pair loader's
 * module doc carries the pair rule, merge contract, and audience rule.
 *
 * `all: true` returns the ENTIRE ordered thread (oldest-first, no page window,
 * no cursor), for callers that need the thread head as well as its tail — the
 * copilot grounding loader (`loadTicketGroundingContext`), which must never drop
 * the original request on a long thread the way the default newest-page window
 * silently would.
 */
export async function listTicketMessages(
  ticketId: TicketId,
  opts: { before?: string; includeInternal?: boolean; all?: boolean } = {}
): Promise<TicketMessagePage> {
  return listPairThreadMessages(ticketId, opts)
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
