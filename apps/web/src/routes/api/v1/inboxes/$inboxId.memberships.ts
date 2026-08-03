/**
 * GET  /api/v1/inboxes/:inboxId/memberships
 * POST /api/v1/inboxes/:inboxId/memberships
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
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { addInboxMembership, listMembershipsForInbox } from '@/lib/server/domains/inboxes'
import { INBOX_MEMBERSHIP_ROLES } from '@/lib/server/db'
import type { InboxId, PrincipalId } from '@quackback/ids'

const addSchema = z.object({
  principalId: z.string().min(1),
  role: z.enum(INBOX_MEMBERSHIP_ROLES),
})

export const Route = createFileRoute('/api/v1/inboxes/$inboxId/memberships')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_VIEW)
          if (!hasPermission(set, PERMISSIONS.INBOX_VIEW)) {
            return forbiddenResponse('inbox.view permission required')
          }
          const id = parseTypeId<InboxId>(params.inboxId, 'inbox', 'inbox ID')
          return successResponse(await listMembershipsForInbox(id))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_MANAGE)
          if (!hasPermission(set, PERMISSIONS.INBOX_MANAGE)) {
            return forbiddenResponse('inbox.manage permission required')
          }
          const inboxId = parseTypeId<InboxId>(params.inboxId, 'inbox', 'inbox ID')
          const body = await request.json().catch(() => null)
          const parsed = addSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const m = await addInboxMembership({
            inboxId,
            principalId: parsed.data.principalId as PrincipalId,
            role: parsed.data.role,
          })
          return createdResponse(m)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
