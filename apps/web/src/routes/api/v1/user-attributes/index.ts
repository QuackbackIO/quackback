/**
 * GET  /api/v1/user-attributes — list custom user-attribute definitions
 * POST /api/v1/user-attributes — create a custom user-attribute definition
 *
 * Scope-gated with user_attribute.* (config-plane): the API key must carry the
 * scope AND the calling principal must hold the permission.
 */
import { createFileRoute } from '@tanstack/react-router'
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
import { createUserAttributeSchema } from '@/lib/shared/schemas/user-attributes'
import { serializeUserAttribute } from './-serialize'

export const Route = createFileRoute('/api/v1/user-attributes/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.USER_ATTRIBUTE_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.USER_ATTRIBUTE_VIEW)) {
            return forbiddenResponse('user_attribute.view permission required')
          }
          const { listUserAttributes } =
            await import('@/lib/server/domains/user-attributes/user-attribute.service')
          const rows = await listUserAttributes()
          return successResponse(rows.map(serializeUserAttribute))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.USER_ATTRIBUTE_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.USER_ATTRIBUTE_MANAGE)) {
            return forbiddenResponse('user_attribute.manage permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = createUserAttributeSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { createUserAttribute } =
            await import('@/lib/server/domains/user-attributes/user-attribute.service')
          const attribute = await createUserAttribute(parsed.data)
          return createdResponse(serializeUserAttribute(attribute))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
