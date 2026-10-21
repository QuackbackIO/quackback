import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseOptionalTypeId, parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { TICKET_TYPES } from '@/lib/shared/db-types'
import { coerceTicketTypeId, TICKET_SORTS } from '@/lib/shared/tickets'
import { isTicketDueFilter } from '@/lib/shared/ticket-due'
import { ticketDueAtWireSchema } from '@/lib/shared/schemas/tickets'
import { serializeTicket } from './-serialize'
import {
  priorityEnum,
  attachmentsSchema,
  toAttachments,
  markdownToSanitizedJson,
} from './-validation'
import type { TicketType, TicketStatusCategory, TicketStage } from '@/lib/server/db'
import type { TicketSort } from '@/lib/server/domains/tickets/ticket.types'
import type { PrincipalId, CompanyId, SegmentId, TicketTypeId } from '@quackback/ids'

const createTicketSchema = z.object({
  // Optional since Phase 4: derivable from ticketTypeId (a mismatched explicit
  // category is rejected by the service); 'customer' stands when neither is given.
  type: z.enum(TICKET_TYPES).optional(),
  // The Phase 4 registry type; drives the category derivation + dynamic fields.
  ticketTypeId: z.string().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  priority: priorityEnum.optional(),
  requesterPrincipalId: z.string().optional(),
  companyId: z.string().optional(),
  attachments: attachmentsSchema,
  // The shared due date as an ISO 8601 instant. A service key is a teammate,
  // so the team window applies (a year back to five years ahead).
  dueAt: ticketDueAtWireSchema.optional(),
})

/** A `sort` query value the list understands; anything else falls back to the default. */
function parseSort(value: string | null): TicketSort | undefined {
  return value && (TICKET_SORTS as readonly string[]).includes(value)
    ? (value as TicketSort)
    : undefined
}

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
          // The Phase 4 registry-type filter — the TypeID check keeps a junk
          // value out of the uuid-backed query (mirrors listTicketsFn).
          const ticketTypeId = coerceTicketTypeId(url.searchParams.get('ticketTypeId'))
          const statusCategory =
            (url.searchParams.get('statusCategory') as TicketStatusCategory | null) ?? undefined
          const stage = (url.searchParams.get('stage') as TicketStage | null) ?? undefined
          const requesterPrincipalId =
            (url.searchParams.get('requesterPrincipalId') as PrincipalId | null) ?? undefined
          const companyId = (url.searchParams.get('companyId') as CompanyId | null) ?? undefined
          const sort = parseSort(url.searchParams.get('sort'))
          // The due filter is a closed set: a typo 400s rather than silently
          // listing every ticket.
          const dueParam = url.searchParams.get('due')
          if (dueParam !== null && !isTicketDueFilter(dueParam)) {
            return badRequestResponse('Invalid due filter')
          }
          const due = isTicketDueFilter(dueParam) ? dueParam : undefined
          // Only the tickets a teammate watches; a malformed id is a 400.
          const watcherParam = url.searchParams.get('watcherPrincipalId')
          const watcherPrincipalId = watcherParam
            ? parseTypeId<PrincipalId>(watcherParam, 'principal', 'watcher principal ID')
            : undefined

          const actor = {
            principalId: auth.principalId,
            role: auth.role,
            principalType: 'service' as const,
            segmentIds: new Set<SegmentId>(),
            permissions: auth.permissions,
          }

          const { listTickets } = await import('@/lib/server/domains/tickets/ticket.service')
          // The wire contract stays a bare array (no cursor param exposed here
          // yet); `hasMore` is dropped, mirroring the admin ticket list fn.
          const { tickets } = await listTickets(
            {
              type,
              ticketTypeId,
              statusCategory,
              stage,
              requesterPrincipalId,
              companyId,
              due,
              watcherPrincipalId,
              sort,
              limit,
            },
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
          const ticketTypeId = parseOptionalTypeId<TicketTypeId>(
            parsed.data.ticketTypeId,
            'ticket_type',
            'ticket type ID'
          )

          const actor = serviceActorFromApiAuth(auth)
          const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
          const dto = await createTicket(
            {
              type: parsed.data.type,
              ticketTypeId,
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
              dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
              // CONVERGENCE PHASE 1b: a customer-intake path — a CUSTOMER ticket
              // created WITH a requester gets its backing conversation + link in
              // the same transaction (createTicketCore's doc carries the
              // contract). Requester-less and non-customer creates are unchanged.
              withBackingConversation: true,
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
