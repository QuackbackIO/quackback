/**
 * Portal-side ticket server functions.
 *
 * Auth model: every handler `requireAuth()`s. There is NO permission check —
 * portal users carry an empty PermissionSet by design. The domain layer
 * (`ticket.portal-query.ts`) gates access by an OWNERSHIP predicate built
 * from the user's principal + linked-contact set.
 *
 * Misses surface as `NotFoundError` (never `Forbidden`) so we don't leak
 * existence of tickets the user has no relationship with.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { db, eq, inArray, principal, user, ticketStatuses } from '@/lib/server/db'
import type { TiptapContent } from '@/lib/server/db'
import {
  listTicketsForPortalUser,
  getTicketForPortalUser,
  addPortalReply,
  updatePortalTicketDescription,
  closePortalTicket,
  reopenPortalTicket,
  buildPortalIdentity,
  resolveViewerRelationship,
  type PortalViewerRelationship,
} from '@/lib/server/domains/tickets/ticket.portal-query'
import { listPublicThreadsForTicket } from '@/lib/server/domains/tickets/ticket.threads'
import type { PrincipalId, TicketId, TicketStatusId, UserId } from '@quackback/ids'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'

const tiptapDocSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough()

const statusCategorySchema = z.enum(['open', 'pending', 'on_hold', 'solved', 'closed'])

interface SerializedTicketRow {
  id: TicketId
  subject: string
  statusId: TicketStatusId
  statusCategory: 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'
  statusName: string
  statusColor: string | null
  lastActivityAt: string
  createdAt: string
}

export const listMyTicketsFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      statusCategory: statusCategorySchema.optional(),
      limit: z.number().int().min(1).max(50).optional(),
      offset: z.number().int().min(0).optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const { rows, total } = await listTicketsForPortalUser({
      userId: ctx.user.id as UserId,
      statusCategory: data.statusCategory,
      limit: data.limit,
      offset: data.offset,
    })
    if (rows.length === 0) return { rows: [] as SerializedTicketRow[], total }

    const statusIdSet = new Set<TicketStatusId>()
    for (const r of rows) {
      if (r.statusId) statusIdSet.add(r.statusId as TicketStatusId)
    }
    const statusIds = Array.from(statusIdSet)
    const statusRows = await db.query.ticketStatuses.findMany({
      where: inArray(ticketStatuses.id, statusIds as TicketStatusId[]),
    })
    const statusById = new Map(statusRows.map((s) => [s.id, s]))

    const serialized: SerializedTicketRow[] = rows.map((r) => {
      const s = r.statusId ? statusById.get(r.statusId as TicketStatusId) : undefined
      return {
        id: r.id as TicketId,
        subject: r.subject,
        statusId: r.statusId as TicketStatusId,
        statusCategory: (s?.category ?? 'open') as SerializedTicketRow['statusCategory'],
        statusName: s?.name ?? 'Unknown',
        statusColor: s?.color ?? null,
        lastActivityAt: toIsoString(r.lastActivityAt),
        createdAt: toIsoString(r.createdAt),
      }
    })
    return { rows: serialized, total }
  })

interface SerializedThread {
  id: string
  principalId: PrincipalId | null
  audience: 'public' | 'internal' | 'shared_team'
  bodyJson: TiptapContent | null
  bodyText: string
  createdAt: string
  editedAt: string | null
}

interface SerializedTicketDetail {
  ticket: {
    id: TicketId
    subject: string
    descriptionJson: TiptapContent | null
    descriptionText: string | null
    statusId: TicketStatusId
    statusCategory: SerializedTicketRow['statusCategory']
    statusName: string
    statusColor: string | null
    requesterPrincipalId: PrincipalId | null
    createdAt: string
    lastActivityAt: string
    updatedAt: string
  }
  threads: SerializedThread[]
  /** Map of principalId → display name. Staff names are stripped to "Support team" by the UI. */
  principalNames: Record<string, string>
  /** The viewer's own principalId, so the UI can show "You" instead of their name. */
  viewerPrincipalId: PrincipalId | null
  /** The viewer's relationship to this ticket — drives what actions are available. */
  viewerRelationship: PortalViewerRelationship
}

export const getMyTicketFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ ticketId: z.string().min(1) }))
  .handler(async ({ data }): Promise<SerializedTicketDetail> => {
    const ctx = await requireAuth()
    const userId = ctx.user.id as UserId

    const ticket = await getTicketForPortalUser({
      userId,
      ticketId: data.ticketId as TicketId,
    })
    const [threads, status, viewerPrincipal, identity] = await Promise.all([
      listPublicThreadsForTicket(ticket.id as TicketId),
      ticket.statusId
        ? db.query.ticketStatuses.findFirst({
            where: eq(ticketStatuses.id, ticket.statusId),
          })
        : Promise.resolve(undefined),
      db.query.principal.findFirst({ where: eq(principal.userId, userId) }),
      buildPortalIdentity(userId),
    ])
    const viewerRelationship = await resolveViewerRelationship(ticket, identity)

    // Hydrate principal display names for each thread author. The UI policy
    // collapses any staff principal to "Support team" — we still need a map
    // so the viewer's own threads are labelled correctly.
    const principalIds = Array.from(
      new Set(threads.map((t) => t.principalId).filter((p): p is PrincipalId => p != null))
    )
    const principalRows = principalIds.length
      ? await db
          .select({
            id: principal.id,
            type: principal.type,
            userName: user.name,
          })
          .from(principal)
          .leftJoin(user, eq(principal.userId, user.id))
          .where(inArray(principal.id, principalIds))
      : []
    const principalNames: Record<string, string> = {}
    for (const row of principalRows) {
      principalNames[row.id] = row.userName ?? 'User'
    }

    return {
      ticket: {
        id: ticket.id as TicketId,
        subject: ticket.subject,
        descriptionJson: (ticket.descriptionJson as TiptapContent | null) ?? null,
        descriptionText: ticket.descriptionText ?? null,
        statusId: ticket.statusId as TicketStatusId,
        statusCategory: (status?.category ?? 'open') as SerializedTicketRow['statusCategory'],
        statusName: status?.name ?? 'Unknown',
        statusColor: status?.color ?? null,
        requesterPrincipalId: (ticket.requesterPrincipalId as PrincipalId | null) ?? null,
        createdAt: toIsoString(ticket.createdAt),
        lastActivityAt: toIsoString(ticket.lastActivityAt),
        updatedAt: toIsoString(ticket.updatedAt),
      },
      threads: threads.map(
        (t): SerializedThread => ({
          id: t.id,
          principalId: (t.principalId as PrincipalId | null) ?? null,
          audience: t.audience as SerializedThread['audience'],
          bodyJson: (t.bodyJson as TiptapContent | null) ?? null,
          bodyText: t.bodyText,
          createdAt: toIsoString(t.createdAt),
          editedAt: toIsoStringOrNull(t.editedAt),
        })
      ),
      principalNames,
      viewerPrincipalId: (viewerPrincipal?.id as PrincipalId | undefined) ?? null,
      viewerRelationship,
    }
  })

export const replyToMyTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketId: z.string().min(1),
      bodyJson: tiptapDocSchema.nullable().optional(),
      bodyText: z.string().max(100_000).nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const thread = await addPortalReply({
      userId: ctx.user.id as UserId,
      ticketId: data.ticketId as TicketId,
      bodyJson: (data.bodyJson ?? null) as never,
      bodyText: data.bodyText ?? null,
    })
    return {
      id: thread.id,
      ticketId: thread.ticketId as TicketId,
      audience: thread.audience as SerializedThread['audience'],
      createdAt: toIsoString(thread.createdAt),
    }
  })

export const updateMyTicketDescriptionFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ticketId: z.string().min(1),
      expectedUpdatedAt: z.string().datetime(),
      descriptionJson: tiptapDocSchema.nullable().optional(),
      descriptionText: z.string().max(100_000).nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const updated = await updatePortalTicketDescription({
      userId: ctx.user.id as UserId,
      ticketId: data.ticketId as TicketId,
      expectedUpdatedAt: new Date(data.expectedUpdatedAt),
      descriptionJson: (data.descriptionJson ?? null) as never,
      descriptionText: data.descriptionText ?? null,
    })
    return {
      id: updated.id as TicketId,
      updatedAt: toIsoString(updated.updatedAt),
    }
  })

export const closeMyTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ ticketId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const updated = await closePortalTicket({
      userId: ctx.user.id as UserId,
      ticketId: data.ticketId as TicketId,
    })
    const status = updated.statusId
      ? await db.query.ticketStatuses.findFirst({
          where: eq(ticketStatuses.id, updated.statusId),
        })
      : undefined
    return {
      id: updated.id as TicketId,
      statusCategory: (status?.category ?? 'solved') as SerializedTicketRow['statusCategory'],
      statusName: status?.name ?? 'Solved',
      updatedAt: toIsoString(updated.updatedAt),
    }
  })

export const reopenMyTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ ticketId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const updated = await reopenPortalTicket({
      userId: ctx.user.id as UserId,
      ticketId: data.ticketId as TicketId,
    })
    const status = updated.statusId
      ? await db.query.ticketStatuses.findFirst({
          where: eq(ticketStatuses.id, updated.statusId),
        })
      : undefined
    return {
      id: updated.id as TicketId,
      statusCategory: (status?.category ?? 'open') as SerializedTicketRow['statusCategory'],
      statusName: status?.name ?? 'Open',
      updatedAt: toIsoString(updated.updatedAt),
    }
  })
