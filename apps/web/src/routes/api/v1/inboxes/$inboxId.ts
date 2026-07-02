/**
 * GET    /api/v1/inboxes/:inboxId
 * PATCH  /api/v1/inboxes/:inboxId
 * DELETE /api/v1/inboxes/:inboxId — archive
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  notFoundResponse,
  forbiddenResponse,
  badRequestResponse,
  noContentResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { archiveInbox, getInbox, updateInbox } from '@/lib/server/domains/inboxes'
import { TICKET_PRIORITIES, TICKET_VISIBILITY_SCOPES } from '@/lib/server/db'
import type { InboxId } from '@quackback/ids'

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  primaryTeamId: z.string().nullable().optional(),
  defaultVisibilityScope: z.enum(TICKET_VISIBILITY_SCOPES).optional(),
  defaultPriority: z.enum(TICKET_PRIORITIES).optional(),
  defaultStatusId: z.string().nullable().optional(),
  color: z.string().max(16).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
})

export const Route = createFileRoute('/api/v1/inboxes/$inboxId')({
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
          const inbox = await getInbox(id)
          if (!inbox) return notFoundResponse('Inbox not found')
          return successResponse(inbox)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_MANAGE)
          if (!hasPermission(set, PERMISSIONS.INBOX_MANAGE)) {
            return forbiddenResponse('inbox.manage permission required')
          }
          const id = parseTypeId<InboxId>(params.inboxId, 'inbox', 'inbox ID')
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const inbox = await updateInbox(id, parsed.data as never, {
            principalId: auth.principalId,
          })
          return successResponse(inbox)
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
          const id = parseTypeId<InboxId>(params.inboxId, 'inbox', 'inbox ID')
          await archiveInbox(id, { principalId: auth.principalId })
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
