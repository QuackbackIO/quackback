/**
 * GET  /api/v1/ticket-statuses
 * POST /api/v1/ticket-statuses
 *
 * The workflow status catalogue used by `/api/v1/tickets/:id/transition`.
 * Distinct from `/api/v1/statuses`, which is for feedback-board posts.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { listTicketStatuses, createTicketStatus } from '@/lib/server/domains/tickets'
import { TICKET_STATUS_CATEGORIES } from '@/lib/server/db'

const createSchema = z.object({
  name: z.string().min(1).max(50),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, 'slug must match [a-z0-9_-]+'),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'color must be a valid hex color')
    .optional(),
  category: z.enum(TICKET_STATUS_CATEGORIES),
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

export const Route = createFileRoute('/api/v1/ticket-statuses/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })
          const url = new URL(request.url)
          const includeDeleted = url.searchParams.get('includeDeleted') === 'true'
          const rows = await listTicketStatuses({ includeDeleted })
          return successResponse(rows.map(serialize))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'admin' })
          const body = await request.json().catch(() => null)
          const parsed = createSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const row = await createTicketStatus(
            {
              name: parsed.data.name,
              slug: parsed.data.slug,
              color: parsed.data.color,
              category: parsed.data.category,
              position: parsed.data.position,
              isDefault: parsed.data.isDefault,
            },
            { principalId: auth.principalId }
          )
          return createdResponse(serialize(row))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
