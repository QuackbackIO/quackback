/**
 * Ticket intake service (convergence Phase 1b) — split from
 * ticket.service.ts (the max-lines budget), same sibling pattern as
 * ticket-type.service→ticket-type-intake.service and sla.service→sla.sweep.
 *
 * Owns `createTicketCore` (the permission-free create every intake path
 * funnels through: the agent `createTicket` wrapper in ticket.service.ts, the
 * requester `createMyTicket` in requester.service.ts, API v1, MCP) — the
 * backing-conversation transaction, the post-commit side-effect gating, and
 * the redirect-failure fallback (see createTicketCore's doc for the full
 * contract) — plus `publishTicketUpdated`, the shared post-write tail
 * ticket.service.ts's other mutators also ride.
 */
import {
  db,
  eq,
  and,
  isNull,
  tickets,
  ticketStatuses,
  conversationMessages,
  ticketConversations,
  conversations,
  principal,
  type Ticket,
  type Conversation,
} from '@/lib/server/db'
import {
  validateContent,
  validateAttachments,
  resolveMessageContent,
  richMessageFallbackLabel,
  preview,
} from '@/lib/server/messages/message-core'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import type { Actor } from '@/lib/server/policy/types'
import { ValidationError, InternalError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { publishTicketEvent } from '@/lib/server/realtime/conversation-channels'
import { emitTicketCreated } from './ticket.webhooks'
import { ticketRowToDTO } from './ticket.dto'
import { recordTicketActivity } from './ticket-activity.service'
import { subscribeToTicket } from './ticket-subscription.service'
import { loadAuthors, fallbackAuthor } from '../principals/principal-display'
import { resolveTicketTypeForCreate } from './ticket-type.service'
import { resolveStage } from './ticket.lifecycle'
import type { CreateTicketInput, TicketDTO } from './ticket.types'

const log = logger.child({ component: 'tickets' })

const MAX_TITLE_LENGTH = 300

/**
 * Rebuild a ticket's DTO and fan the unified-inbox realtime signal (unified
 * inbox §3.2, M3) — the common tail of every mutator (create, status, assign,
 * priority, soft-delete): re-enrich the just-written row, then
 * `publishTicketEvent('ticket_updated')` so every open inbox re-renders the
 * row. Returns the DTO so callers can still return/reuse it. Defined beside
 * the create path (this module); ticket.service.ts's other mutators import it
 * from here so the tail exists exactly once.
 */
export async function publishTicketUpdated(row: Ticket): Promise<TicketDTO> {
  const dto = await ticketRowToDTO(row)
  publishTicketEvent(row.id, { kind: 'ticket_updated', ticket: dto })
  return dto
}

/**
 * Open a ticket WITHOUT a permission check — the caller authorizes (agent
 * TICKET_CREATE via createTicket, or requester self-creation via createMyTicket).
 * Resolves the default status; `number` auto-increments.
 *
 * The input's assignee/company are stored as given — the AGENT defaulting
 * rules (inherit the source conversation's assignee, else the creating agent;
 * propagate the requester's company) live in `createTicket`, so the requester
 * intake (`createMyTicket`) keeps its born-unassigned, company-less shape.
 * The watcher set is resolved here, though, in the create transaction: the
 * requester (reason 'requester'), a distinct assignee ('assignee'), and the
 * creating principal when they are neither ('manual') — the last skipped when
 * the actor's principal id doesn't resolve to a real row (a bare/synthetic id
 * could never satisfy the subscription's FK), so self-creation by the
 * requester adds nothing beyond their 'requester' row.
 *
 * CONVERGENCE PHASE 1b — BACKING CONVERSATION AT INTAKE (convergence-design.md,
 * mechanics appendix "Intake (Phase 1b)" + the side-effect model's intake
 * table). When `input.withBackingConversation` is set on a CUSTOMER ticket
 * with a requester (the opt-in only the four customer-intake paths set —
 * portal `createMyTicket`, the widget fn, API v1, MCP `create_ticket`), the
 * create transaction becomes:
 *
 *   ONE transaction: create the backing conversation (channel 'messenger',
 *   source 'ticket_form', status 'open', `visitorPrincipalId` = the ticket's requester — the pair
 *   is identity-consistent by construction, so the Phase 1a delegates'
 *   ownership gates pass and requester replies land cleanly) → create the
 *   ticket → insert `ticket_conversations` (ticket_type 'customer'). A
 *   failure in ANY insert rolls the whole intake back — no orphaned ticket,
 *   conversation, or link. The opening message then writes through
 *   `insertTicketMessage` AFTER commit (it re-parents to the conversation
 *   automatically per the Phase 1a redirect, running the full conversation
 *   write pipeline there); it rides post-commit because that pipeline owns
 *   its own transaction + side effects, and it is failure-isolated (a
 *   redirect failure degrades to a legacy ticket-parented opening row, which
 *   the Phase 0 union loader reads identically — the intake itself never
 *   500s after the pair committed). Pre-1b standalone customer tickets are
 *   NOT backfilled — the union loader degenerates gracefully on them.
 *
 * The backing conversation IS a conversation, so its creation raises the
 * conversation side effects — gated per the design's intake table:
 *
 *   | conversation.created workflows  | FIRE     | existing graphs keep working
 *   | conversation.created webhooks   | FIRE     | (both ride emitConversationCreated below)
 *   | notifyConversationStarted       | SUPPRESS | the requester just filed the ticket — noise
 *   | auto-routing                    | SUPPRESS | the ticket's born-owned assignee rules govern
 *   | Quinn (assistant turn)          | SUPPRESS | pair conversations are gated out of the
 *   |                                 |          | assistant at the dispatch site
 *   |                                 |          | (conversation.service.ts), at intake AND on
 *   |                                 |          | every later visitor message
 *
 * Firing `ticket.created` only after the link exists also closes the
 * ticket.created-before-link ordering race worked around in
 * workflows/event-trigger.ts's TICKET_CREATED_LINK_POLL. The SLA handoff
 * (`handoffConversationSlaToTicket`, shared with linkTicketToConversation)
 * runs for parity: a fresh backing conversation is born SLA-free, so it is a
 * no-op here by construction. Agent/back-office creates (no flag) are
 * byte-identical to before — standalone, no backing conversation.
 */
export async function createTicketCore(input: CreateTicketInput, actor: Actor): Promise<TicketDTO> {
  const title = input.title?.trim()
  if (!title) throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Title must be ${MAX_TITLE_LENGTH} characters or less`
    )
  }

  const [defaultStatus] = await db
    .select({
      id: ticketStatuses.id,
      category: ticketStatuses.category,
      publicStage: ticketStatuses.publicStage,
    })
    .from(ticketStatuses)
    .where(and(eq(ticketStatuses.isDefault, true), isNull(ticketStatuses.deletedAt)))
    .limit(1)
  if (!defaultStatus) {
    throw new InternalError('NO_DEFAULT_STATUS', 'No default ticket status is configured')
  }

  // CONVERGENCE PHASE 4 derivation: when a registry type is chosen, its
  // category IS tickets.type (a mismatched explicit category is rejected);
  // without one the legacy explicit-category path stands.
  const resolvedType = await resolveTicketTypeForCreate({
    ticketTypeId: input.ticketTypeId,
    category: input.type,
  })

  // Same sanitize/validate idioms as insertTicketMessage (ticket-message.service):
  // sanitize the doc, cap/validate attachments, derive the plaintext mirror from
  // the doc when the raw description is blank, and let a text-less rich doc
  // (image/embed) satisfy the empty-content guard via its fallback label. Run
  // ahead of the transaction — it's pure validation, no I/O.
  const openingAttachments = validateAttachments(input.attachments)
  // The description is the requester's own ask when they file the ticket
  // themselves — their inline images may only reference our own storage.
  const filedByRequester =
    !!actor.principalId && actor.principalId === (input.requesterPrincipalId ?? null)
  const safeDescriptionJson = input.descriptionJson
    ? sanitizeTiptapContent(input.descriptionJson, {
        restrictImagesToTrustedOrigins: filedByRequester,
      })
    : null
  const fallbackLabel = richMessageFallbackLabel(safeDescriptionJson)
  const resolvedDescription = resolveMessageContent(input.description ?? '', safeDescriptionJson)
  const hasOpeningMessage =
    !!resolvedDescription.trim() || openingAttachments.length > 0 || !!fallbackLabel

  // CONVERGENCE PHASE 1b (see the doc header for the full contract + gating
  // table): only the flagged customer-intake paths, and only a CUSTOMER ticket
  // WITH a requester, gain a backing conversation. Everything else (agent
  // standalone create, back-office/tracker, requester-less API/MCP creates)
  // takes the legacy shape unchanged.
  const wantsBackingConversation =
    input.withBackingConversation === true &&
    resolvedType.category === 'customer' &&
    !!input.requesterPrincipalId
  // The opening message rides the Phase 1a redirect onto the backing
  // conversation AFTER commit — except the un-attributable edge: an
  // agent-authored opening whose actor carries no principal id (a bare service
  // actor; every real API/MCP actor resolves one) can't be attributed by the
  // redirect's delegates, so it keeps the legacy in-transaction ticket-parented
  // insert, which the union loader reads identically.
  const openingViaRedirect =
    wantsBackingConversation && hasOpeningMessage && (filedByRequester || !!actor.principalId)

  const created = await db.transaction(async (tx) => {
    // PHASE 1b (1/3): the backing conversation FIRST, so the pair is
    // identity-consistent by construction — visitorPrincipalId IS the ticket's
    // requester. (Legacy edge, NOT this phase: a pre-1a pair can have
    // conversation.visitor ≠ ticket.requester; reconciling those is a
    // documented follow-up.) Channel is 'messenger' with source
    // 'ticket_form': the row arrived on a ticket intake form — the
    // non-widget source keeps shouldConsiderAssistant's widget-source gate
    // from matching, a defense-in-depth layer under the primary pair-link
    // Quinn gate (conversation.service.ts). waitingSince/visitorLastReadAt start at the
    // intake instant — the requester just acted and is waiting on the team;
    // the opening-message pipeline below overwrites both with its own
    // message-time stamps when there is one.
    let backingConversation: Conversation | null = null
    if (wantsBackingConversation && input.requesterPrincipalId) {
      const intakeAt = new Date()
      ;[backingConversation] = await tx
        .insert(conversations)
        .values({
          visitorPrincipalId: input.requesterPrincipalId,
          channel: 'messenger',
          source: 'ticket_form',
          status: 'open',
          subject: hasOpeningMessage
            ? preview(resolvedDescription || fallbackLabel, openingAttachments)
            : preview(title, []),
          waitingSince: intakeAt,
          visitorLastReadAt: intakeAt,
        })
        .returning()
    }

    const [ticket] = await tx
      .insert(tickets)
      .values({
        type: resolvedType.category,
        ticketTypeId: resolvedType.ticketTypeId,
        title,
        statusId: defaultStatus.id,
        priority: input.priority ?? 'none',
        requesterPrincipalId: input.requesterPrincipalId ?? null,
        assigneePrincipalId: input.assigneePrincipalId ?? null,
        companyId: input.companyId ?? null,
        customAttributes: input.customAttributes ?? {},
      })
      .returning()

    // PHASE 1b (2/3): the pair link, same transaction — 1:1 by the partial
    // unique indexes; the requester-side actor may not resolve to a team
    // principal, so linkedByPrincipalId degrades to null exactly like a
    // synthetic actor's watcher row does below.
    if (backingConversation) {
      await tx.insert(ticketConversations).values({
        ticketId: ticket.id,
        conversationId: backingConversation.id,
        ticketType: 'customer',
        linkedByPrincipalId: actor.principalId ?? null,
      })
    }

    if (hasOpeningMessage && !openingViaRedirect) {
      // The description opens the thread. It is the requester's ask when they
      // file it themselves (senderType 'visitor'), or a teammate's summary when
      // filing on someone's behalf ('agent'). Either way it is the opening
      // message, not a reply, so it never stamps first_response_at. PHASE 1b
      // (3/3): skipped when the opening rides the redirect onto the backing
      // conversation instead (see below).
      await tx.insert(conversationMessages).values({
        ticketId: ticket.id,
        principalId: actor.principalId,
        senderType: filedByRequester ? 'visitor' : 'agent',
        content: validateContent(
          resolvedDescription,
          openingAttachments.length > 0 || !!fallbackLabel
        ),
        contentJson: safeDescriptionJson,
        attachments: openingAttachments.length > 0 ? openingAttachments : null,
      })
    }

    // The watcher set from birth, in the same transaction so the first fan-out
    // can never race past the subscription rows. The requester watches their
    // own ticket (reason 'requester'); a distinct assignee watches as
    // 'assignee'; the creating principal watches as 'manual' when they are
    // neither — skipped when their id resolves to no real principal row (the
    // subscription FKs principal, so a bare/synthetic actor id could never be
    // written). First-reason-wins ordering: requester, then assignee, then
    // creator, with onConflictDoNothing collapsing any overlap.
    if (input.requesterPrincipalId) {
      await subscribeToTicket(input.requesterPrincipalId, ticket.id, 'requester', { tx })
    }
    if (input.assigneePrincipalId && input.assigneePrincipalId !== input.requesterPrincipalId) {
      await subscribeToTicket(input.assigneePrincipalId, ticket.id, 'assignee', { tx })
    }
    if (
      actor.principalId &&
      actor.principalId !== input.requesterPrincipalId &&
      actor.principalId !== input.assigneePrincipalId
    ) {
      const [creator] = await tx
        .select({ id: principal.id })
        .from(principal)
        .where(eq(principal.id, actor.principalId))
        .limit(1)
      if (creator) await subscribeToTicket(actor.principalId, ticket.id, 'manual', { tx })
    }
    return { ticket, backingConversation }
  })

  // PHASE 1b post-commit, backing conversations only — the side-effect gating
  // table in the doc header. Order: the opening message first (so a
  // conversation.created handler dispatched below finds the full opening
  // context, the same guarantee the native messenger flow's ordering gives),
  // then emitConversationCreated (workflows + webhooks FIRE), then the SLA
  // handoff. The suppressed three (started-notify, auto-routing, Quinn) are
  // simply never invoked here; Quinn is additionally gated at the
  // conversation.service dispatch site for every later visitor message.
  if (created.backingConversation) {
    const backingConversation = created.backingConversation
    if (openingViaRedirect) {
      // The opening message through the insertTicketMessage choke point: the
      // Phase 1a redirect lands it on the conversation with the full write
      // pipeline (last-message denorm, wait clock, read stamps,
      // message.created, realtime). Failure-isolated: the pair already
      // committed, so a redirect failure (e.g. the requester is
      // messenger-blocked — a gate createMyTicket never checked pre-1b)
      // degrades to the legacy ticket-parented opening row rather than 500ing
      // an intake that succeeded; the union loader reads both shapes.
      try {
        const { insertTicketMessage } = await import('./ticket-message.service')
        await insertTicketMessage(
          {
            ticketId: created.ticket.id,
            content: input.description ?? '',
            contentJson: input.descriptionJson ?? null,
            attachments: input.attachments,
          },
          // openingViaRedirect guarantees this is non-null: the requester when
          // they filed it themselves, the agent's principal otherwise.
          (filedByRequester ? input.requesterPrincipalId : actor.principalId)!,
          {
            senderType: filedByRequester ? 'visitor' : 'agent',
            isInternal: false,
            stampFirstResponse: false,
            actor,
          }
        )
      } catch (err) {
        // The redirect is a pipeline, not an insert: it can fail AFTER the
        // message row committed (a post-commit side effect — realtime
        // publish, notify). Probe before falling back, or that class of
        // failure would DUPLICATE the opening (one row per parent).
        const [landed] = await db
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, backingConversation.id))
          .limit(1)
        if (landed) {
          log.warn(
            { err, ticket_id: created.ticket.id, conversation_id: backingConversation.id },
            'opening-message redirect failed post-commit; the row landed, no fallback needed'
          )
        } else {
          log.error(
            { err, ticket_id: created.ticket.id, conversation_id: backingConversation.id },
            'opening-message redirect failed; falling back to a ticket-parented opening row'
          )
          try {
            await db.insert(conversationMessages).values({
              ticketId: created.ticket.id,
              principalId: actor.principalId,
              senderType: filedByRequester ? 'visitor' : 'agent',
              content: validateContent(
                resolvedDescription,
                openingAttachments.length > 0 || !!fallbackLabel
              ),
              contentJson: safeDescriptionJson,
              attachments: openingAttachments.length > 0 ? openingAttachments : null,
            })
          } catch (fallbackErr) {
            log.error(
              { err: fallbackErr, ticket_id: created.ticket.id },
              'fallback opening-message insert failed; the pair stands without an opening message'
            )
          }
        }
      }
    }
    // conversation.created FIRES (the gating table's two FIRE rows ride this
    // one emission). The event author is who opened the conversation: the
    // requester on the visitor-intake paths, the filing principal on
    // agent-authored intake (the requester as last resort — every intake path
    // has one). Fire-and-forget like every emit* call.
    const openingPrincipalId =
      (filedByRequester ? input.requesterPrincipalId : actor.principalId) ??
      input.requesterPrincipalId!
    const author =
      (await loadAuthors([openingPrincipalId])).get(openingPrincipalId) ??
      fallbackAuthor(openingPrincipalId)
    const { emitConversationCreated } = await import('../conversation/conversation.webhooks')
    void emitConversationCreated(actor, author, backingConversation)
    // SLA handoff parity with linkTicketToConversation (shared helper): a
    // fresh backing conversation is born SLA-free, so this no-ops by
    // construction — it exists so the intake can never drift from the link
    // flow's handoff rule.
    const { handoffConversationSlaToTicket } = await import('./ticket-conversation-link.service')
    await handoffConversationSlaToTicket(created.ticket.id, backingConversation.id)
  }

  log.info({ ticket_id: created.ticket.id, type: created.ticket.type }, 'ticket created')
  // Durable timeline record (fire-and-forget, mirrors the post-side
  // activity log). Written after the transaction commits so a failed
  // activity insert can never abort the creation itself.
  recordTicketActivity({
    ticketId: created.ticket.id,
    principalId: actor.principalId,
    type: 'ticket.created',
    metadata: { ticketType: created.ticket.type },
  })
  // PHASE 1b: emitted AFTER the pair link exists (same transaction) and after
  // the backing conversation's side effects above — a ticket.created dispatch
  // now always finds the link, closing the ordering race
  // workflows/event-trigger.ts's TICKET_CREATED_LINK_POLL worked around.
  void emitTicketCreated(actor, created.ticket, {
    category: defaultStatus.category,
    stage: resolveStage(defaultStatus),
  })
  // Realtime signal (unified inbox §3.2, M3): a fresh ticket is a new inbox
  // row, so the same 'ticket_updated' kind the update paths use below also
  // covers creation, mirroring how the conversation domain's 'conversation'
  // event has no separate created/updated split.
  return publishTicketUpdated(created.ticket)
}
