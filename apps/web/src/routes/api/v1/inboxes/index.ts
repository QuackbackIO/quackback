/**
 * GET  /api/v1/inboxes — list inboxes
 * POST /api/v1/inboxes — create inbox
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
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { createInbox, listInboxes } from '@/lib/server/domains/inboxes'
import { TICKET_PRIORITIES, TICKET_VISIBILITY_SCOPES } from '@/lib/server/db'

const createSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  primaryTeamId: z.string().nullable().optional(),
  defaultVisibilityScope: z.enum(TICKET_VISIBILITY_SCOPES).optional(),
  defaultPriority: z.enum(TICKET_PRIORITIES).optional(),
  defaultStatusId: z.string().nullable().optional(),
  color: z.string().max(16).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
})

export const Route = createFileRoute('/api/v1/inboxes/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_VIEW)
          if (!hasPermission(set, PERMISSIONS.INBOX_VIEW)) {
            return forbiddenResponse('inbox.view permission required')
          }
          const url = new URL(request.url)
          const includeArchived = url.searchParams.get('includeArchived') === 'true'
          const rows = await listInboxes({ includeArchived })
          return successResponse(rows)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_MANAGE)
          if (!hasPermission(set, PERMISSIONS.INBOX_MANAGE)) {
            return forbiddenResponse('inbox.manage permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = createSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const inbox = await createInbox(parsed.data as never, {
            principalId: auth.principalId,
          })
          return createdResponse(inbox)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
