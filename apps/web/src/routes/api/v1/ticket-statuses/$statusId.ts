/**
 * GET    /api/v1/ticket-statuses/:statusId
 * PATCH  /api/v1/ticket-statuses/:statusId
 * DELETE /api/v1/ticket-statuses/:statusId   (archive; rejects if referenced)
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  notFoundResponse,
  badRequestResponse,
  conflictResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { db, tickets, eq, and, isNull, sql } from '@/lib/server/db'
import {
  getTicketStatus,
  updateTicketStatus,
  archiveTicketStatus,
} from '@/lib/server/domains/tickets'
import { TICKET_STATUS_CATEGORIES } from '@/lib/server/db'
import type { TicketStatusId } from '@quackback/ids'

const updateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'color must be a valid hex color')
    .optional(),
  category: z.enum(TICKET_STATUS_CATEGORIES).optional(),
  position: z.number().int().min(0).optional(),
  isDefault: z.boolean().optional(),
})

function serialize(row: {
  id: string
  name: string
  slug: string
  color: string | null
  category: string
  position: number
  isDefault: boolean
  isSystem: boolean
  createdAt: Date
  deletedAt: Date | null
}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    category: row.category,
    position: row.position,
    isDefault: row.isDefault,
    isSystem: row.isSystem,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

export const Route = createFileRoute('/api/v1/ticket-statuses/$statusId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })
          const id = parseTypeId<TicketStatusId>(params.statusId, 'ticket_status', 'status ID')
          const row = await getTicketStatus(id)
          if (!row) return notFoundResponse('Ticket status')
          return successResponse(serialize(row))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'admin' })
          const id = parseTypeId<TicketStatusId>(params.statusId, 'ticket_status', 'status ID')
          const body = await request.json().catch(() => null)
          const parsed = updateSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const row = await updateTicketStatus(id, parsed.data, {
            principalId: auth.principalId,
          })
          return successResponse(serialize(row))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'admin' })
          const id = parseTypeId<TicketStatusId>(params.statusId, 'ticket_status', 'status ID')

          // Block archive when active tickets still reference this status, so
          // we don't orphan their `statusId`. Match the behaviour we use for
          // inboxes archival (no cascade reassign).
          const refRows = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(tickets)
            .where(and(eq(tickets.statusId, id), isNull(tickets.deletedAt)))
          const referencedBy = refRows[0]?.count ?? 0
          if (referencedBy > 0) {
            return conflictResponse(
              `ticket status is still referenced by ${referencedBy} active ticket(s)`
            )
          }

          await archiveTicketStatus(id, { principalId: auth.principalId })
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
