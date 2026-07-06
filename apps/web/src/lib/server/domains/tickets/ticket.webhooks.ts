/**
 * Ticket → webhook event bridge (support platform §4.2). Maps ticket rows to
 * sanitized event payloads and dispatches them on the shared event bus. Called
 * fire-and-forget from ticket.service after a write commits: a dispatch failure
 * must never break the write (mirrors conversation.webhooks).
 *
 * These are the agent/integration-facing lifecycle signals. The customer-facing
 * status signal (the requester's bell + the thread status event) rides the
 * public_stage crossing inside ticket.service and is deliberately not a webhook.
 *
 * A requester reply DOES fire ticket.replied (with senderType 'visitor'): a
 * customer reply is activity the team's integrations want, distinct from the
 * customer's own bell. Internal-note content ships in full (see the note on
 * EventTicketMessageData): ticket events only ever reach admin-configured
 * consumers, never a per-user or public subscription.
 */
import type { Ticket } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import type {
  EventActor,
  EventTicketData,
  EventTicketMessageAttachment,
  EventTicketRef,
} from '@/lib/server/events/types'
import {
  dispatchTicketCreated,
  dispatchTicketStatusChanged,
  dispatchTicketAssigned,
  dispatchTicketReplied,
  dispatchTicketNoteAdded,
} from '@/lib/server/events/dispatch'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ticket-webhooks' })

/** The actor is the teammate/requester who acted, never the ticket's requester
 *  (they differ when a teammate files on someone's behalf). No author email is
 *  carried: unlike a conversation message, a ticket write has no author record. */
function toEventActor(actor: Actor): EventActor {
  const principalId = actor.principalId ?? undefined
  if (actor.principalType === 'service') return { type: 'service', principalId }
  return { type: 'user', principalId }
}

function ticketRef(t: Ticket): EventTicketRef {
  return {
    id: t.id,
    number: t.number,
    type: t.type,
    priority: t.priority,
    assignedPrincipalId: t.assigneePrincipalId ?? null,
    assignedTeamId: t.assigneeTeamId ?? null,
  }
}

function ticketData(
  t: Ticket,
  status: { category: 'open' | 'pending' | 'closed'; stage: string | null }
): EventTicketData {
  return {
    ...ticketRef(t),
    title: t.title,
    status: status.category,
    stage: status.stage,
    requesterPrincipalId: t.requesterPrincipalId ?? null,
    companyId: t.companyId ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
  }
}

async function safe(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    log.warn({ err, label }, 'webhook failed')
  }
}

/** Ticket-message attachments as the sanitized event shape, or null when none. */
function messageAttachments(m: ConversationMessageDTO): EventTicketMessageAttachment[] | null {
  if (!m.attachments || m.attachments.length === 0) return null
  return m.attachments.map((a) => ({
    name: a.name,
    url: a.url,
    contentType: a.contentType,
    size: a.size,
  }))
}

export async function emitTicketCreated(
  actor: Actor,
  ticket: Ticket,
  status: { category: 'open' | 'pending' | 'closed'; stage: string | null }
): Promise<void> {
  await safe('ticket.created', () =>
    dispatchTicketCreated(toEventActor(actor), ticketData(ticket, status))
  )
}

export async function emitTicketStatusChanged(
  actor: Actor,
  ticket: Ticket,
  previousStatus: 'open' | 'pending' | 'closed',
  newStatus: 'open' | 'pending' | 'closed',
  stage: string | null
): Promise<void> {
  await safe('ticket.status_changed', () =>
    dispatchTicketStatusChanged(
      toEventActor(actor),
      ticketRef(ticket),
      previousStatus,
      newStatus,
      stage
    )
  )
}

export async function emitTicketAssigned(
  actor: Actor,
  ticket: Ticket,
  previousPrincipalId: string | null,
  previousTeamId: string | null
): Promise<void> {
  await safe('ticket.assigned', () =>
    dispatchTicketAssigned(
      toEventActor(actor),
      ticketRef(ticket),
      ticket.assigneePrincipalId ?? null,
      previousPrincipalId,
      ticket.assigneeTeamId ?? null,
      previousTeamId
    )
  )
}

/** A reply on a customer ticket thread — an agent reply or the requester's own
 *  reply. senderType disambiguates the two for consumers. */
export async function emitTicketReplied(
  actor: Actor,
  ticket: Ticket,
  message: ConversationMessageDTO
): Promise<void> {
  await safe('ticket.replied', () =>
    dispatchTicketReplied(
      toEventActor(actor),
      ticketRef(ticket),
      message.id,
      contentJsonToMarkdown(message.contentJson, message.content),
      messageAttachments(message),
      message.senderType === 'visitor' ? 'visitor' : 'agent'
    )
  )
}

/** An agent-only internal note added to a ticket thread (never customer-visible). */
export async function emitTicketNoteAdded(
  actor: Actor,
  ticket: Ticket,
  message: ConversationMessageDTO
): Promise<void> {
  await safe('ticket.note_added', () =>
    dispatchTicketNoteAdded(
      toEventActor(actor),
      ticketRef(ticket),
      message.id,
      contentJsonToMarkdown(message.contentJson, message.content),
      messageAttachments(message),
      'agent'
    )
  )
}
