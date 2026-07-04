/**
 * Ticket wire-DTO mapping (support platform §4.2). Owns the row → DTO transform
 * and the batched reference lookups (statuses, principals, teams, companies,
 * stage labels) that back it — one query per table, no N+1. Kept separate from
 * ticket.service so the mutation logic and the read-shape stay at their own
 * altitudes.
 */
import {
  db,
  inArray,
  ticketStatuses,
  teams,
  companies,
  type Ticket,
  type TicketStatusEntity,
} from '@/lib/server/db'
import type { TicketStatusId, PrincipalId, TeamId, CompanyId } from '@quackback/ids'
import { formatTicketNumber, type TicketStageLabels } from '@/lib/shared/tickets'
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
}

function uniqueIds<T extends string>(ids: ReadonlyArray<T | null | undefined>): T[] {
  return [...new Set(ids.filter((id): id is T => !!id))]
}

/** Resolve every reference a page of tickets needs in one batch per table. */
export async function buildTicketContext(rows: Ticket[]): Promise<TicketDTOContext> {
  const statusIds = uniqueIds(rows.map((r) => r.statusId))
  const teamIds = uniqueIds(rows.map((r) => r.assigneeTeamId))
  const companyIds = uniqueIds(rows.map((r) => r.companyId))

  const [statusRows, principals, teamRows, companyRows, stageLabels] = await Promise.all([
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
  ])

  return {
    statuses: new Map(statusRows.map((s) => [s.id, s])),
    principals,
    teams: new Map(teamRows.map((t) => [t.id, t.name])),
    companies: new Map(companyRows.map((c) => [c.id, c.name])),
    stageLabels,
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
  }
}

/** Load + map a single ticket row (used by the write paths + getTicket). */
export async function ticketRowToDTO(row: Ticket): Promise<TicketDTO> {
  return ticketToDTO(row, await buildTicketContext([row]))
}
