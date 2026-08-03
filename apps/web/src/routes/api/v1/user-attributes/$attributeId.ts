/**
 * GET    /api/v1/user-attributes/:attributeId — fetch one definition
 * PATCH  /api/v1/user-attributes/:attributeId — update a definition
 * DELETE /api/v1/user-attributes/:attributeId — delete a definition
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  forbiddenResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { updateUserAttributeSchema } from '@/lib/shared/schemas/user-attributes'
import { serializeUserAttribute } from './-serialize'
import type { UserAttributeId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/user-attributes/$attributeId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.USER_ATTRIBUTE_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.USER_ATTRIBUTE_VIEW)) {
            return forbiddenResponse('user_attribute.view permission required')
          }
          const attributeId = parseTypeId<UserAttributeId>(
            params.attributeId,
            'user_attr',
            'user attribute ID'
          )
          const { listUserAttributes } =
            await import('@/lib/server/domains/user-attributes/user-attribute.service')
          const attribute = (await listUserAttributes()).find((a) => a.id === attributeId)
          if (!attribute) return notFoundResponse('User attribute')
          return successResponse(serializeUserAttribute(attribute))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.USER_ATTRIBUTE_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.USER_ATTRIBUTE_MANAGE)) {
            return forbiddenResponse('user_attribute.manage permission required')
          }
          const attributeId = parseTypeId<UserAttributeId>(
            params.attributeId,
            'user_attr',
            'user attribute ID'
          )
          const body = await request.json().catch(() => null)
          const parsed = updateUserAttributeSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { updateUserAttribute } =
            await import('@/lib/server/domains/user-attributes/user-attribute.service')
          const attribute = await updateUserAttribute(attributeId, parsed.data)
          return successResponse(serializeUserAttribute(attribute))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.USER_ATTRIBUTE_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.USER_ATTRIBUTE_MANAGE)) {
            return forbiddenResponse('user_attribute.manage permission required')
          }
          const attributeId = parseTypeId<UserAttributeId>(
            params.attributeId,
            'user_attr',
            'user attribute ID'
          )
          const { deleteUserAttribute } =
            await import('@/lib/server/domains/user-attributes/user-attribute.service')
          await deleteUserAttribute(attributeId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
