/**
 * GET /api/v1/tickets — scope-aware queue
 * POST /api/v1/tickets — create
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
  decodeCursor,
  encodeCursor,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { createTicket, listTickets, type TicketQueueScope } from '@/lib/server/domains/tickets'
import { TICKET_PRIORITIES, TICKET_CHANNELS, TICKET_VISIBILITY_SCOPES } from '@/lib/server/db'
import { recordEvent } from '@/lib/server/domains/audit'

const createSchema = z.object({
  subject: z.string().min(1).max(500),
  descriptionJson: z.unknown().nullable().optional(),
  descriptionText: z.string().max(100_000).nullable().optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  channel: z.enum(TICKET_CHANNELS).optional(),
  visibilityScope: z.enum(TICKET_VISIBILITY_SCOPES).optional(),
  statusId: z.string().nullable().optional(),
  primaryTeamId: z.string().nullable().optional(),
  assigneePrincipalId: z.string().nullable().optional(),
  assigneeTeamId: z.string().nullable().optional(),
  requesterPrincipalId: z.string().nullable().optional(),
  requesterContactId: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
  inboxId: z.string().nullable().optional(),
})

const SCOPES = [
  'all',
  'my_assigned',
  'my_team',
  'shared_with_me',
  'unassigned',
  'my_inbox',
  'inbox',
] as const
const STATUS_CATEGORIES = ['open', 'pending', 'on_hold', 'solved', 'closed'] as const

export const Route = createFileRoute('/api/v1/tickets/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const url = new URL(request.url)
          const scope = (url.searchParams.get('scope') || 'my_team') as TicketQueueScope
          if (!SCOPES.includes(scope as (typeof SCOPES)[number])) {
            return badRequestResponse(`Invalid scope: ${String(scope)}`)
          }
          const statusCategory = url.searchParams.get('statusCategory') || undefined
          if (
            statusCategory &&
            !STATUS_CATEGORIES.includes(statusCategory as (typeof STATUS_CATEGORIES)[number])
          ) {
            return badRequestResponse(`Invalid statusCategory: ${statusCategory}`)
          }
          const search = url.searchParams.get('search') ?? undefined
          const inboxIdRaw = url.searchParams.get('inboxId')
          const inboxId =
            inboxIdRaw === null
              ? undefined
              : inboxIdRaw === 'null' || inboxIdRaw === ''
                ? null
                : (inboxIdRaw as never)
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
          const offset = decodeCursor(cursor)

          const { rows, total } = await listTickets({
            scope,
            permissionSet: set,
            statusCategory: statusCategory as never,
            search,
            inboxId,
            limit: limit + 1,
            offset,
          })
          const hasMore = rows.length > limit
          const page = hasMore ? rows.slice(0, limit) : rows
          const nextCursor = hasMore ? encodeCursor(offset + limit) : null
          return successResponse(page, {
            pagination: { cursor: nextCursor, hasMore, total },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.TICKET_EDIT_FIELDS)
          if (!hasPermission(set, PERMISSIONS.TICKET_EDIT_FIELDS)) {
            return forbiddenResponse('ticket.edit_fields permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = createSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const ticket = await createTicket({
            ...(parsed.data as Record<string, unknown>),
            createdByPrincipalId: auth.principalId,
          } as never)
          await recordEvent({
            principalId: auth.principalId,
            action: 'ticket.created',
            targetType: 'ticket',
            targetId: ticket.id,
            source: 'api',
            diff: { context: { subject: ticket.subject } },
          })
          return createdResponse(ticket)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
