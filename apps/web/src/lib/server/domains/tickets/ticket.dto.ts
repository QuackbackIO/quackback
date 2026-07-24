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
  or,
  isNull,
  inArray,
  desc,
  ticketStatuses,
  ticketTypes,
  teams,
  companies,
  conversationMessages,
  type Ticket,
  type TicketStatusEntity,
  type TicketTypeEntity,
} from '@/lib/server/db'
import type {
  TicketId,
  TicketStatusId,
  TicketTypeId,
  PrincipalId,
  TeamId,
  CompanyId,
} from '@quackback/ids'
import type { ConversationId } from '@quackback/ids'
import type { TicketStatusCategory } from '@/lib/shared/db-types'
import type { JsonValue } from '@/lib/shared/json'
import { formatTicketNumber, type TicketStageLabels } from '@/lib/shared/tickets'
import { preview } from '@/lib/server/messages/message-core'
import { loadAuthors, fallbackAuthor } from '../principals/principal-display'
import { getStageLabels } from '../settings/settings.tickets'
import { resolveStage } from './ticket.lifecycle'
import { resolvePairConversationIds } from './pair-thread.service'
import type { TicketSlaApplied } from '../sla/ticket-sla.service'
import type {
  TicketDTO,
  TicketPrincipalRef,
  TicketSlaRef,
  TicketTypeRef,
  RequesterTicketDTO,
} from './ticket.types'

interface TicketDTOContext {
  statuses: Map<TicketStatusId, TicketStatusEntity>
  ticketTypes: Map<TicketTypeId, TicketTypeEntity>
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
 * CONVERGENCE PHASE 3 — UNION ACTIVITY: a linked customer pair's activity is
 * the union of BOTH parents. Post-1a writes land on the conversation, so a
 * ticket-parent-only read would freeze the pair's list-row preview at the
 * conversion point. The page's pair links resolve in one batched query
 * (`resolvePairConversationIds`), then each concern runs a second DISTINCT ON
 * over the linked conversation ids (served by the `(conversation_id,
 * created_at, id)` index) and the two parents' winners merge in code — newer
 * `createdAt` wins, the same total order the pair-thread loader merges on.
 * Unlinked threads (back-office/tracker, standalone customer) skip the second
 * pair of queries entirely.
 *
 * A single-ticket page (every write path, via `ticketRowToDTO`) takes a
 * cheaper path: two plain parent-scoped `ORDER BY created_at DESC LIMIT 1`
 * lookups instead of a `DISTINCT ON` over a one-element `IN` list — same
 * indexes, same two round trips, without the DISTINCT ON machinery a mutation
 * enriching a single fresh row doesn't need. On a linked pair the parent
 * predicate is an OR over both parents of the pair.
 */
async function loadTicketActivity(rows: Ticket[]): Promise<Map<TicketId, TicketActivity>> {
  const map = new Map<TicketId, TicketActivity>()
  for (const r of rows) map.set(r.id, { lastMessageAt: null, lastMessagePreview: r.title })
  if (rows.length === 0) return map

  const pairByTicket = await resolvePairConversationIds(rows.map((r) => r.id))

  if (rows.length === 1) {
    const id = rows[0].id
    const pairConversationId = pairByTicket.get(id)
    const parentScope = pairConversationId
      ? or(
          eq(conversationMessages.ticketId, id),
          eq(conversationMessages.conversationId, pairConversationId)
        )
      : eq(conversationMessages.ticketId, id)
    const [[latestAny], [latestVisible]] = await Promise.all([
      db
        .select({ createdAt: conversationMessages.createdAt })
        .from(conversationMessages)
        .where(and(parentScope, isNull(conversationMessages.deletedAt)))
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
            parentScope,
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
  const linkedConversationIds = [...new Set(pairByTicket.values())]
  const [latestAny, latestVisible, latestAnyPair, latestVisiblePair] = await Promise.all([
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
        // The cross-parent merge below compares this row's recency against the
        // conversation parent's winner, so the visible query carries it too.
        createdAt: conversationMessages.createdAt,
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
    // The pair union's second parent: the linked conversations' own latest
    // rows, one per conversation, merged in code below.
    linkedConversationIds.length
      ? db
          .selectDistinctOn([conversationMessages.conversationId], {
            conversationId: conversationMessages.conversationId,
            createdAt: conversationMessages.createdAt,
          })
          .from(conversationMessages)
          .where(
            and(
              inArray(conversationMessages.conversationId, linkedConversationIds),
              isNull(conversationMessages.deletedAt)
            )
          )
          .orderBy(conversationMessages.conversationId, desc(conversationMessages.createdAt))
      : Promise.resolve([]),
    linkedConversationIds.length
      ? db
          .selectDistinctOn([conversationMessages.conversationId], {
            conversationId: conversationMessages.conversationId,
            createdAt: conversationMessages.createdAt,
            content: conversationMessages.content,
            attachments: conversationMessages.attachments,
          })
          .from(conversationMessages)
          .where(
            and(
              inArray(conversationMessages.conversationId, linkedConversationIds),
              isNull(conversationMessages.deletedAt),
              eq(conversationMessages.isInternal, false)
            )
          )
          .orderBy(conversationMessages.conversationId, desc(conversationMessages.createdAt))
      : Promise.resolve([]),
  ])

  // The inner join-free selects guarantee a non-null parent id (the XOR CHECK
  // makes exactly one parent column non-null on every row).
  for (const row of latestAny) {
    const entry = map.get(row.ticketId as TicketId)
    if (entry) entry.lastMessageAt = row.createdAt
  }
  // Each preview winner's timestamp, for the cross-parent recency compare.
  const previewAt = new Map<TicketId, Date>()
  for (const row of latestVisible) {
    const entry = map.get(row.ticketId as TicketId)
    if (entry) {
      entry.lastMessagePreview = preview(row.content, row.attachments ?? [])
      previewAt.set(row.ticketId as TicketId, row.createdAt)
    }
  }

  if (latestAnyPair.length > 0 || latestVisiblePair.length > 0) {
    const ticketByConversation = new Map<ConversationId, TicketId>()
    for (const [ticketId, conversationId] of pairByTicket) {
      ticketByConversation.set(conversationId, ticketId)
    }
    for (const row of latestAnyPair) {
      const ticketId = ticketByConversation.get(row.conversationId as ConversationId)
      if (!ticketId) continue
      const entry = map.get(ticketId)
      // Newer of the two parents wins (the pair merge's total order).
      if (entry && (!entry.lastMessageAt || row.createdAt > entry.lastMessageAt)) {
        entry.lastMessageAt = row.createdAt
      }
    }
    for (const row of latestVisiblePair) {
      const ticketId = ticketByConversation.get(row.conversationId as ConversationId)
      if (!ticketId) continue
      const entry = map.get(ticketId)
      if (!entry) continue
      const current = previewAt.get(ticketId)
      if (!current || row.createdAt > current) {
        entry.lastMessagePreview = preview(row.content, row.attachments ?? [])
        previewAt.set(ticketId, row.createdAt)
      }
    }
  }
  return map
}

function uniqueIds<T extends string>(ids: ReadonlyArray<T | null | undefined>): T[] {
  return [...new Set(ids.filter((id): id is T => !!id))]
}

/**
 * Project the ticket's SLA stamp (support platform §4.6's ticket-anchored TTR
 * clock) into its DTO sliver, or null when no SLA is applied. `paused` is
 * STATUS-derived — a 'pending'-category status under a pauseOnPending policy
 * — mirroring the conversation chip's `snoozed && pauseOnSnooze` rule
 * (slaChipState), so the chip agrees with the status pill it renders next to
 * even in the brief window before the event hook stamps `pausedAt`.
 */
function ticketSlaRefFor(slaApplied: unknown, category: TicketStatusCategory): TicketSlaRef | null {
  if (!slaApplied || typeof slaApplied !== 'object') return null
  const stamp = slaApplied as TicketSlaApplied
  // A live stamp always carries the deadline (applySlaToTicket refuses to
  // stamp a TTR-less policy); the guard is for hand-written/legacy rows.
  if (!stamp.timeToResolveDueAt) return null
  return {
    policyName: stamp.policyName,
    timeToResolveDueAt: stamp.timeToResolveDueAt,
    resolvedAt: stamp.resolvedAt ?? null,
    paused: category === 'pending' && stamp.pauseOnPending !== false,
  }
}

/** Resolve every reference a page of tickets needs in one batch per table. */
export async function buildTicketContext(rows: Ticket[]): Promise<TicketDTOContext> {
  const statusIds = uniqueIds(rows.map((r) => r.statusId))
  const ticketTypeIds = uniqueIds(rows.map((r) => r.ticketTypeId))
  const teamIds = uniqueIds(rows.map((r) => r.assigneeTeamId))
  const companyIds = uniqueIds(rows.map((r) => r.companyId))

  const [statusRows, ticketTypeRows, principals, teamRows, companyRows, stageLabels, activity] =
    await Promise.all([
      statusIds.length
        ? db.select().from(ticketStatuses).where(inArray(ticketStatuses.id, statusIds))
        : Promise.resolve([] as TicketStatusEntity[]),
      // Archived types included deliberately: an archived type still renders
      // its chip on ticket history (archive keeps history — Phase 4).
      ticketTypeIds.length
        ? db.select().from(ticketTypes).where(inArray(ticketTypes.id, ticketTypeIds))
        : Promise.resolve([] as TicketTypeEntity[]),
      // Reuse the inbox's principal loader so the avatar-precedence rule
      // (user.image → uploaded key → principal copy) stays in one place.
      loadAuthors([
        ...rows.map((r) => r.requesterPrincipalId),
        ...rows.map((r) => r.assigneePrincipalId),
      ]),
      teamIds.length
        ? db
            .select({ id: teams.id, name: teams.name })
            .from(teams)
            .where(inArray(teams.id, teamIds))
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
    ticketTypes: new Map(ticketTypeRows.map((t) => [t.id, t])),
    principals,
    teams: new Map(teamRows.map((t) => [t.id, t.name])),
    companies: new Map(companyRows.map((c) => [c.id, c.name])),
    stageLabels,
    activity,
  }
}

/** Map a ticket row + a resolved context to its wire DTO. The default 'agent'
 *  audience gets the full shape; 'requester' strips the internal status and
 *  the SLA sliver (see RequesterTicketDTO — mirrors the conversation DTO's
 *  `side` split, which strips SLA for visitors). */
export function ticketToDTO(row: Ticket, ctx: TicketDTOContext): TicketDTO
export function ticketToDTO(row: Ticket, ctx: TicketDTOContext, audience: 'agent'): TicketDTO
export function ticketToDTO(
  row: Ticket,
  ctx: TicketDTOContext,
  audience: 'requester'
): RequesterTicketDTO
export function ticketToDTO(
  row: Ticket,
  ctx: TicketDTOContext,
  audience: 'agent' | 'requester' = 'agent'
): TicketDTO | RequesterTicketDTO {
  const status = ctx.statuses.get(row.statusId)
  const slot = status ? resolveStage(status) : null
  const requester = row.requesterPrincipalId
    ? (ctx.principals.get(row.requesterPrincipalId) ?? fallbackAuthor(row.requesterPrincipalId))
    : null
  const assignee = row.assigneePrincipalId
    ? (ctx.principals.get(row.assigneePrincipalId) ?? fallbackAuthor(row.assigneePrincipalId))
    : null

  const dto: TicketDTO = {
    id: row.id,
    number: row.number,
    reference: formatTicketNumber(row.number),
    type: row.type,
    ticketType: row.ticketTypeId ? toTicketTypeRef(ctx.ticketTypes.get(row.ticketTypeId)) : null,
    title: row.title,
    status: status
      ? { id: status.id, name: status.name, color: status.color, category: status.category }
      : { id: row.statusId, name: 'Unknown', color: '#6b7280', category: 'open' },
    // `closed` feeds the generic-close projection (B22, see TicketStageRef):
    // a null-stage closed status shows the customer a localized "Closed",
    // never the internal status name.
    stage: {
      slot,
      label: slot ? ctx.stageLabels[slot] : null,
      closed: status?.category === 'closed',
    },
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
    sla: ticketSlaRefFor(row.slaApplied, status?.category ?? 'open'),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reopenedCount: row.reopenedCount,
    customAttributes: (row.customAttributes as Record<string, JsonValue> | null) ?? {},
    lastMessagePreview: ctx.activity.get(row.id)?.lastMessagePreview ?? row.title,
    lastMessageAt: ctx.activity.get(row.id)?.lastMessageAt?.toISOString() ?? null,
  }
  if (audience === 'requester') return toRequesterTicketDTO(dto)
  return dto
}

/** Project a registry type row to its DTO ref (null when the id didn't
 *  resolve — a hard-deleted type via the FK escape hatch). */
function toTicketTypeRef(row: TicketTypeEntity | undefined): TicketTypeRef | null {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    icon: row.icon,
    color: row.color,
  }
}

/** Load + map a single ticket row (used by the write paths + getTicket). */
export async function ticketRowToDTO(row: Ticket): Promise<TicketDTO> {
  return ticketToDTO(row, await buildTicketContext([row]))
}

/** Strip the agent-only fields (internal status, SLA sliver) from an agent
 *  DTO — the requester audience projection (see RequesterTicketDTO). */
export function toRequesterTicketDTO(dto: TicketDTO): RequesterTicketDTO {
  return { ...dto, status: null, sla: null }
}
