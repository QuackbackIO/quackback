/**
 * GET   /api/v1/settings/help-center — read help-center configuration
 * PATCH /api/v1/settings/help-center — update help-center configuration
 *
 * Gated by admin.manage_settings.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { updateHelpCenterConfigSchema } from '@/lib/shared/schemas/help-center'

export const Route = createFileRoute('/api/v1/settings/help-center')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_SETTINGS)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_SETTINGS)) {
            return forbiddenResponse('admin.manage_settings permission required')
          }
          const { getHelpCenterConfig } =
            await import('@/lib/server/domains/settings/settings.service')
          return successResponse(await getHelpCenterConfig())
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PATCH: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_SETTINGS)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_SETTINGS)) {
            return forbiddenResponse('admin.manage_settings permission required')
          }
          const parsed = updateHelpCenterConfigSchema.safeParse(
            await request.json().catch(() => null)
          )
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { updateHelpCenterConfig } =
            await import('@/lib/server/domains/settings/settings.service')
          return successResponse(await updateHelpCenterConfig(parsed.data))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
