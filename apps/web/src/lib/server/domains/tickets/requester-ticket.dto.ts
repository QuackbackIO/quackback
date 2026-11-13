/**
 * The requester audience of the ticket DTO: what a customer receives about
 * their own ticket on the portal and in the Messenger. Built from an explicit
 * allow-list (`RequesterTicketDTO`), never by trimming the agent DTO, so a key
 * added for teammates never reaches customers by default.
 */
import {
  db,
  inArray,
  isNotNull,
  sql,
  tickets,
  ticketStatuses,
  type Ticket,
  type TicketTypeEntity,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { PrincipalId, TicketId, TicketStatusId } from '@quackback/ids'
import type { JsonValue } from '@/lib/shared/json'
import { formatTicketNumber } from '@/lib/shared/tickets'
import { readAttributeValue } from '@/lib/shared/conversation/attribute-values'
import { fallbackAuthor } from '../principals/principal-display'
import { STATUS_MOVES } from './ticket-activity.service'
import { buildTicketContext, stageFor, toTicketTypeRef, type TicketDTOContext } from './ticket.dto'
import type { RequesterTicketDTO } from './ticket.types'

/** A ticket DTO context plus each ticket's customer-visible update time. */
export interface RequesterTicketDTOContext extends TicketDTOContext {
  requesterUpdatedAt: Map<TicketId, Date>
}

/**
 * The ids of statuses that show the customer a stage (a non-null
 * `publicStage`). Archived statuses are included: a past move into one was
 * visible to the customer when it happened.
 */
export async function loadStagedStatusIds(): Promise<TicketStatusId[]> {
  const rows = await db
    .select({ id: ticketStatuses.id })
    .from(ticketStatuses)
    .where(isNotNull(ticketStatuses.publicStage))
  return rows.map((r) => r.id)
}

/**
 * The last change a requester can see on a ticket, as one SQL expression over
 * the outer `tickets` row. First non-null of:
 *
 * 1. the newest message on the ticket's thread (the ticket's own rows and its
 *    pair conversation's rows) that is public, not deleted and not a system
 *    line. Internal notes are excluded, and so are system lines such as the
 *    pair conversation's "assigned to" notice;
 * 2. the newest status move (`status.changed` or `ticket.reopened`) into a
 *    status in `stagedStatusIds`. Activity rows hold status ids as app ids in
 *    their metadata, so the staged set is read first (`loadStagedStatusIds`)
 *    and bound here;
 * 3. the ticket's `createdAt`.
 *
 * `tickets.updated_at` is never read: internal notes, assignment and priority
 * changes move it. Each arm is a `LIMIT 1` subquery on an existing
 * `(parent, created_at)` index. Inner tables use raw aliases and the outer row
 * is named in full, so the expression reads the same in a single-table select
 * list (where Drizzle drops column prefixes) and in an ORDER BY.
 */
export function requesterUpdatedAtSql(stagedStatusIds: readonly TicketStatusId[]): SQL<Date> {
  const ticketId = sql.raw('"tickets"."id"')
  const customerVisible = sql.raw(
    "m.is_internal = false AND m.deleted_at IS NULL AND m.sender_type <> 'system'"
  )
  const moveTypes = sql.join(
    STATUS_MOVES.map((t) => sql`${t}`),
    sql`, `
  )
  const intoStagedStatus =
    stagedStatusIds.length > 0
      ? sql`a.metadata->>'toId' IN (${sql.join(
          stagedStatusIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      : sql`false`
  return sql<Date>`COALESCE(
    GREATEST(
      (SELECT m.created_at FROM conversation_messages m
        WHERE m.ticket_id = ${ticketId} AND ${customerVisible}
        ORDER BY m.created_at DESC LIMIT 1),
      (SELECT m.created_at FROM ticket_conversations tc
        JOIN conversation_messages m ON m.conversation_id = tc.conversation_id
        WHERE tc.ticket_id = ${ticketId} AND tc.ticket_type = 'customer' AND ${customerVisible}
        ORDER BY m.created_at DESC LIMIT 1)
    ),
    (SELECT a.created_at FROM ticket_activity a
      WHERE a.ticket_id = ${ticketId} AND a.type IN (${moveTypes}) AND ${intoStagedStatus}
      ORDER BY a.created_at DESC LIMIT 1),
    ${sql.raw('"tickets"."created_at"')}
  )`.mapWith(tickets.createdAt)
}

/** `buildTicketContext` plus each ticket's customer-visible update time. */
export async function buildRequesterTicketContext(
  rows: Ticket[]
): Promise<RequesterTicketDTOContext> {
  const [ctx, stagedStatusIds] = await Promise.all([
    buildTicketContext(rows),
    loadStagedStatusIds(),
  ])
  const requesterUpdatedAt = new Map<TicketId, Date>()
  if (rows.length > 0) {
    const times = await db
      .select({ id: tickets.id, at: requesterUpdatedAtSql(stagedStatusIds) })
      .from(tickets)
      .where(
        inArray(
          tickets.id,
          rows.map((r) => r.id)
        )
      )
    for (const t of times) requesterUpdatedAt.set(t.id, t.at)
  }
  return { ...ctx, requesterUpdatedAt }
}

/**
 * The stored answers a requester may see: only keys of fields that the
 * ticket's live type marks visible to customers. Conversation attributes that
 * share the jsonb column, internal fields and keys no field defines are left
 * out. A `{ v, src, at }` envelope is an attribute write, not the customer's
 * intake answer, so it is left out too, even under a visible field's key (the
 * two share one jsonb column and their keys can collide). A typeless ticket,
 * or one whose type is archived or gone, has no customer-visible answers.
 */
function customerVisibleAnswers(
  row: Ticket,
  type: TicketTypeEntity | undefined
): Record<string, JsonValue> {
  if (!type || type.deletedAt) return {}
  const stored = (row.customAttributes as Record<string, JsonValue> | null) ?? {}
  const answers: Record<string, JsonValue> = {}
  for (const field of type.fields) {
    if (!field.visibleToCustomer || !Object.hasOwn(stored, field.key)) continue
    const value = stored[field.key]
    if (readAttributeValue(value)?.src) continue
    answers[field.key] = value
  }
  return answers
}

/**
 * Build the requester DTO key by key from the allow-list in
 * `RequesterTicketDTO`. Names come from each principal's public view.
 */
export function toRequesterTicketDTO(
  row: Ticket,
  ctx: RequesterTicketDTOContext
): RequesterTicketDTO {
  const status = ctx.statuses.get(row.statusId)
  const publicName = (id: PrincipalId | null) => {
    if (!id) return null
    return ctx.principals.get(id)?.publicAuthor ?? fallbackAuthor(id)
  }
  const requester = publicName(row.requesterPrincipalId)
  const assignee = publicName(row.assigneePrincipalId)
  const ticketType = row.ticketTypeId ? ctx.ticketTypes.get(row.ticketTypeId) : undefined
  return {
    id: row.id,
    number: row.number,
    reference: formatTicketNumber(row.number),
    type: row.type,
    ticketType: row.ticketTypeId ? toTicketTypeRef(ticketType) : null,
    title: row.title,
    stage: stageFor(status, ctx.stageLabels),
    requester: requester
      ? {
          principalId: requester.principalId,
          displayName: requester.displayName,
          avatarUrl: requester.avatarUrl,
        }
      : null,
    assignee: {
      principalId: row.assigneePrincipalId ?? null,
      displayName: assignee?.displayName ?? null,
    },
    company: row.companyId
      ? { id: row.companyId, name: ctx.companies.get(row.companyId) ?? 'Unknown' }
      : null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: (ctx.requesterUpdatedAt.get(row.id) ?? row.createdAt).toISOString(),
    customAttributes: customerVisibleAnswers(row, ticketType),
    lastMessagePreview: ctx.activity.get(row.id)?.lastMessagePreview ?? row.title,
  }
}
