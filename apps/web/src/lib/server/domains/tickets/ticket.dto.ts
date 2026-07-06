/**
 * Ticket wire-DTO mapping (support platform §4.2). Owns the row → DTO transform
 * and the batched reference lookups (statuses, principals, teams, companies,
 * stage labels) that back it — one query per table, no N+1. Kept separate from
 * ticket.service so the mutation logic and the read-shape stay at their own
 * altitudes.
 */
import {
  db,
  eq,
  and,
  isNull,
  inArray,
  desc,
  ticketStatuses,
  teams,
  companies,
  conversationMessages,
  type Ticket,
  type TicketStatusEntity,
} from '@/lib/server/db'
import type { TicketId, TicketStatusId, PrincipalId, TeamId, CompanyId } from '@quackback/ids'
import type { JsonValue } from '@/lib/shared/json'
import { formatTicketNumber, type TicketStageLabels } from '@/lib/shared/tickets'
import { preview } from '@/lib/server/messages/message-core'
import { loadAuthors, fallbackAuthor } from '../principals/principal-display'
import { getStageLabels } from '../settings/settings.tickets'
import { resolveStage } from './ticket.lifecycle'
import type { TicketDTO, TicketPrincipalRef } from './ticket.types'

interface TicketDTOContext {
  statuses: Map<TicketStatusId, TicketStatusEntity>
  principals: Map<PrincipalId, TicketPrincipalRef>
  teams: Map<TeamId, string>
  companies: Map<CompanyId, string>
  stageLabels: TicketStageLabels
  activity: Map<TicketId, TicketActivity>
}

/** A ticket's activity snapshot for the list/DTO (see `loadTicketActivity`). */
interface TicketActivity {
  lastMessageAt: Date | null
  lastMessagePreview: string | null
}

/**
 * Batch-load each ticket's activity snapshot in one page: `lastMessageAt` is the
 * newest non-deleted message of ANY kind (an internal note still counts as
 * activity), while `lastMessagePreview` prefers the latest customer-visible
 * message — truncated the same way the conversation inbox derives its preview
 * (`preview()`, message-core) — and falls back to the ticket's own title when
 * only internal notes exist or the thread is empty. Two DISTINCT ON queries
 * (one per concern) rather than one merged query, since the "latest of any
 * kind" and "latest non-internal" rows can differ; both are served by the
 * existing `(ticket_id, created_at, id)` index.
 *
 * A single-ticket page (every write path, via `ticketRowToDTO`) takes a
 * cheaper path: two plain `eq(ticketId) ORDER BY created_at DESC LIMIT 1`
 * lookups instead of a `DISTINCT ON` over a one-element `IN` list — same
 * index, same two round trips, without the DISTINCT ON machinery a mutation
 * enriching a single fresh row doesn't need.
 */
async function loadTicketActivity(rows: Ticket[]): Promise<Map<TicketId, TicketActivity>> {
  const map = new Map<TicketId, TicketActivity>()
  for (const r of rows) map.set(r.id, { lastMessageAt: null, lastMessagePreview: r.title })
  if (rows.length === 0) return map

  if (rows.length === 1) {
    const id = rows[0].id
    const [[latestAny], [latestVisible]] = await Promise.all([
      db
        .select({ createdAt: conversationMessages.createdAt })
        .from(conversationMessages)
        .where(and(eq(conversationMessages.ticketId, id), isNull(conversationMessages.deletedAt)))
        .orderBy(desc(conversationMessages.createdAt))
        .limit(1),
      db
        .select({
          content: conversationMessages.content,
          attachments: conversationMessages.attachments,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.ticketId, id),
            isNull(conversationMessages.deletedAt),
            eq(conversationMessages.isInternal, false)
          )
        )
        .orderBy(desc(conversationMessages.createdAt))
        .limit(1),
    ])
    const entry = map.get(id)!
    if (latestAny) entry.lastMessageAt = latestAny.createdAt
    if (latestVisible)
      entry.lastMessagePreview = preview(latestVisible.content, latestVisible.attachments ?? [])
    return map
  }

  const ids = rows.map((r) => r.id)
  const [latestAny, latestVisible] = await Promise.all([
    db
      .selectDistinctOn([conversationMessages.ticketId], {
        ticketId: conversationMessages.ticketId,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .where(
        and(inArray(conversationMessages.ticketId, ids), isNull(conversationMessages.deletedAt))
      )
      .orderBy(conversationMessages.ticketId, desc(conversationMessages.createdAt)),
    db
      .selectDistinctOn([conversationMessages.ticketId], {
        ticketId: conversationMessages.ticketId,
        content: conversationMessages.content,
        attachments: conversationMessages.attachments,
      })
      .from(conversationMessages)
      .where(
        and(
          inArray(conversationMessages.ticketId, ids),
          isNull(conversationMessages.deletedAt),
          eq(conversationMessages.isInternal, false)
        )
      )
      .orderBy(conversationMessages.ticketId, desc(conversationMessages.createdAt)),
  ])

  // The inner join-free selects guarantee a non-null ticketId (the column is
  // NOT NULL for every ticket-thread message).
  for (const row of latestAny) {
    const entry = map.get(row.ticketId as TicketId)
    if (entry) entry.lastMessageAt = row.createdAt
  }
  for (const row of latestVisible) {
    const entry = map.get(row.ticketId as TicketId)
    if (entry) entry.lastMessagePreview = preview(row.content, row.attachments ?? [])
  }
  return map
}

function uniqueIds<T extends string>(ids: ReadonlyArray<T | null | undefined>): T[] {
  return [...new Set(ids.filter((id): id is T => !!id))]
}

/** Resolve every reference a page of tickets needs in one batch per table. */
export async function buildTicketContext(rows: Ticket[]): Promise<TicketDTOContext> {
  const statusIds = uniqueIds(rows.map((r) => r.statusId))
  const teamIds = uniqueIds(rows.map((r) => r.assigneeTeamId))
  const companyIds = uniqueIds(rows.map((r) => r.companyId))

  const [statusRows, principals, teamRows, companyRows, stageLabels, activity] = await Promise.all([
    statusIds.length
      ? db.select().from(ticketStatuses).where(inArray(ticketStatuses.id, statusIds))
      : Promise.resolve([] as TicketStatusEntity[]),
    // Reuse the inbox's principal loader so the avatar-precedence rule
    // (user.image → uploaded key → principal copy) stays in one place.
    loadAuthors([
      ...rows.map((r) => r.requesterPrincipalId),
      ...rows.map((r) => r.assigneePrincipalId),
    ]),
    teamIds.length
      ? db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds))
      : Promise.resolve([] as Array<{ id: TeamId; name: string }>),
    companyIds.length
      ? db
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(inArray(companies.id, companyIds))
      : Promise.resolve([] as Array<{ id: CompanyId; name: string }>),
    getStageLabels(),
    loadTicketActivity(rows),
  ])

  return {
    statuses: new Map(statusRows.map((s) => [s.id, s])),
    principals,
    teams: new Map(teamRows.map((t) => [t.id, t.name])),
    companies: new Map(companyRows.map((c) => [c.id, c.name])),
    stageLabels,
    activity,
  }
}

/** Map a ticket row + a resolved context to its wire DTO. */
export function ticketToDTO(row: Ticket, ctx: TicketDTOContext): TicketDTO {
  const status = ctx.statuses.get(row.statusId)
  const slot = status ? resolveStage(status) : null
  const requester = row.requesterPrincipalId
    ? (ctx.principals.get(row.requesterPrincipalId) ?? fallbackAuthor(row.requesterPrincipalId))
    : null
  const assignee = row.assigneePrincipalId
    ? (ctx.principals.get(row.assigneePrincipalId) ?? fallbackAuthor(row.assigneePrincipalId))
    : null

  return {
    id: row.id,
    number: row.number,
    reference: formatTicketNumber(row.number),
    type: row.type,
    title: row.title,
    status: status
      ? { id: status.id, name: status.name, color: status.color, category: status.category }
      : { id: row.statusId, name: 'Unknown', color: '#6b7280', category: 'open' },
    stage: { slot, label: slot ? ctx.stageLabels[slot] : null },
    priority: row.priority,
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
      teamId: row.assigneeTeamId ?? null,
      teamName: row.assigneeTeamId ? (ctx.teams.get(row.assigneeTeamId) ?? null) : null,
    },
    company: row.companyId
      ? { id: row.companyId, name: ctx.companies.get(row.companyId) ?? 'Unknown' }
      : null,
    firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reopenedCount: row.reopenedCount,
    customAttributes: (row.customAttributes as Record<string, JsonValue> | null) ?? {},
    lastMessagePreview: ctx.activity.get(row.id)?.lastMessagePreview ?? row.title,
    lastMessageAt: ctx.activity.get(row.id)?.lastMessageAt?.toISOString() ?? null,
  }
}

/** Load + map a single ticket row (used by the write paths + getTicket). */
export async function ticketRowToDTO(row: Ticket): Promise<TicketDTO> {
  return ticketToDTO(row, await buildTicketContext([row]))
}
