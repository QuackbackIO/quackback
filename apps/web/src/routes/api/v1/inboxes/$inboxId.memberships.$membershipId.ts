/**
 * PATCH  /api/v1/inboxes/:inboxId/memberships/:membershipId — change role
 * DELETE /api/v1/inboxes/:inboxId/memberships/:membershipId
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  badRequestResponse,
  noContentResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { removeInboxMembership, updateInboxMembershipRole } from '@/lib/server/domains/inboxes'
import { INBOX_MEMBERSHIP_ROLES } from '@/lib/server/db'
import type { InboxMembershipId } from '@quackback/ids'

const patchSchema = z.object({ role: z.enum(INBOX_MEMBERSHIP_ROLES) })

export const Route = createFileRoute('/api/v1/inboxes/$inboxId/memberships/$membershipId')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_MANAGE)
          if (!hasPermission(set, PERMISSIONS.INBOX_MANAGE)) {
            return forbiddenResponse('inbox.manage permission required')
          }
          const id = parseTypeId<InboxMembershipId>(
            params.membershipId,
            'inbox_mem',
            'membership ID'
          )
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          return successResponse(await updateInboxMembershipRole(id, parsed.data.role))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_MANAGE)
          if (!hasPermission(set, PERMISSIONS.INBOX_MANAGE)) {
            return forbiddenResponse('inbox.manage permission required')
          }
          const id = parseTypeId<InboxMembershipId>(
            params.membershipId,
            'inbox_mem',
            'membership ID'
          )
          await removeInboxMembership(id)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
