import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseOptionalTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { TICKET_TYPES } from '@/lib/shared/db-types'
import { serializeTicket } from './-serialize'
import {
  priorityEnum,
  attachmentsSchema,
  toAttachments,
  markdownToSanitizedJson,
} from './-validation'
import type { TicketType, TicketStatusCategory, TicketStage } from '@/lib/server/db'
import type { TicketSort } from '@/lib/server/domains/tickets/ticket.types'
import type { PrincipalId, CompanyId, SegmentId } from '@quackback/ids'

const createTicketSchema = z.object({
  type: z.enum(TICKET_TYPES),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  priority: priorityEnum.optional(),
  requesterPrincipalId: z.string().optional(),
  companyId: z.string().optional(),
  attachments: attachmentsSchema,
})

export const Route = createFileRoute('/api/v1/tickets/')({
  server: {
    handlers: {
      /** GET /api/v1/tickets — list tickets (team API key). Filters mirror the
       *  admin list; results are team-wide (a service actor sees every ticket). */
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_VIEW })

          const url = new URL(request.url)
          const limit = Math.min(
            100,
            Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
          )
          const type = (url.searchParams.get('type') as TicketType | null) ?? undefined
          const statusCategory =
            (url.searchParams.get('statusCategory') as TicketStatusCategory | null) ?? undefined
          const stage = (url.searchParams.get('stage') as TicketStage | null) ?? undefined
          const requesterPrincipalId =
            (url.searchParams.get('requesterPrincipalId') as PrincipalId | null) ?? undefined
          const companyId = (url.searchParams.get('companyId') as CompanyId | null) ?? undefined
          const sort = (url.searchParams.get('sort') as TicketSort | null) ?? undefined

          const actor = {
            principalId: auth.principalId,
            role: auth.role,
            principalType: 'service' as const,
            segmentIds: new Set<SegmentId>(),
          }

          const { listTickets } = await import('@/lib/server/domains/tickets/ticket.service')
          // The wire contract stays a bare array (no cursor param exposed here
          // yet); `hasMore` is dropped, mirroring the admin ticket list fn.
          const { tickets } = await listTickets(
            { type, statusCategory, stage, requesterPrincipalId, companyId, sort, limit },
            actor
          )

          return successResponse(tickets.map(serializeTicket))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /** POST /api/v1/tickets — open a ticket as a team API key (a service actor). */
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_CREATE })

          const parsed = createTicketSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const requesterPrincipalId = parseOptionalTypeId<PrincipalId>(
            parsed.data.requesterPrincipalId,
            'principal',
            'requester principal ID'
          )
          const companyId = parseOptionalTypeId<CompanyId>(
            parsed.data.companyId,
            'company',
            'company ID'
          )

          const actor = serviceActorFromApiAuth(auth)
          const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
          const dto = await createTicket(
            {
              type: parsed.data.type,
              title: parsed.data.title,
              description: parsed.data.description,
              // Derive a sanitized rich doc from the markdown description so the
              // opening message renders like every other write path (D3).
              descriptionJson: parsed.data.description
                ? markdownToSanitizedJson(parsed.data.description)
                : undefined,
              priority: parsed.data.priority,
              requesterPrincipalId,
              companyId,
              attachments: toAttachments(parsed.data.attachments),
            },
            actor
          )

          return createdResponse(serializeTicket(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
