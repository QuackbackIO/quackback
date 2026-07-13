import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  noContentResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import {
  linkContactToUser,
  listLinksForContact,
  unlinkContactFromUser,
} from '@/lib/server/domains/organizations'
import { recordEvent } from '@/lib/server/domains/audit'
import type { ContactId, UserId } from '@quackback/ids'

const linkSchema = z.object({ userId: z.string().min(1) })

export const Route = createFileRoute('/api/v1/contacts/$contactId/links')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ORG_VIEW)
          if (!hasPermission(set, PERMISSIONS.ORG_VIEW)) {
            return forbiddenResponse('org.view permission required')
          }
          const id = parseTypeId<ContactId>(params.contactId, 'contact', 'contact ID')
          const links = await listLinksForContact(id)
          return successResponse(links)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ORG_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ORG_MANAGE)) {
            return forbiddenResponse('org.manage permission required')
          }
          const id = parseTypeId<ContactId>(params.contactId, 'contact', 'contact ID')
          const body = await request.json().catch(() => null)
          const parsed = linkSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const userId = parseTypeId<UserId>(parsed.data.userId, 'user', 'user ID')
          const link = await linkContactToUser(
            {
              contactId: id,
              userId,
              linkedByPrincipalId: auth.principalId,
            },
            { principalId: auth.principalId }
          )
          await recordEvent({
            principalId: auth.principalId,
            action: 'contact.linked_user',
            targetType: 'contact',
            targetId: id,
            source: 'api',
            diff: { context: { userId } },
          })
          return createdResponse(link)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ORG_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ORG_MANAGE)) {
            return forbiddenResponse('org.manage permission required')
          }
          const id = parseTypeId<ContactId>(params.contactId, 'contact', 'contact ID')
          const url = new URL(request.url)
          const userIdParam = url.searchParams.get('userId')
          if (!userIdParam) return badRequestResponse('userId query param required')
          const userId = parseTypeId<UserId>(userIdParam, 'user', 'user ID')
          await unlinkContactFromUser(id, userId, { principalId: auth.principalId })
          await recordEvent({
            principalId: auth.principalId,
            action: 'contact.unlinked_user',
            targetType: 'contact',
            targetId: id,
            source: 'api',
            diff: { context: { userId } },
          })
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
