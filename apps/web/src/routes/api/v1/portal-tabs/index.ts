/**
 * GET /api/v1/portal-tabs — read org-level portal tab visibility defaults
 * PUT /api/v1/portal-tabs — replace org-level portal tab visibility defaults
 *
 * Org defaults that gate which tabs portal users see. Per-segment overrides live
 * under /portal-tabs/segments. Portal tab config is a config-plane resource:
 * scope-gated with portal.manage (the API key must carry the scope AND the
 * calling principal must hold the permission) for both read and write.
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
import { portalTabConfigSchema } from '@/lib/shared/schemas/portal-tabs'

export const Route = createFileRoute('/api/v1/portal-tabs/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.PORTAL_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.PORTAL_MANAGE)) {
            return forbiddenResponse('portal.manage permission required')
          }
          const { getOrgPortalTabConfig } = await import('@/lib/server/domains/portal/index.server')
          const config = await getOrgPortalTabConfig()
          return successResponse(config)
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PUT: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.PORTAL_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.PORTAL_MANAGE)) {
            return forbiddenResponse('portal.manage permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = portalTabConfigSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { setOrgPortalTabConfig, getOrgPortalTabConfig } =
            await import('@/lib/server/domains/portal/index.server')
          await setOrgPortalTabConfig(parsed.data)
          return successResponse(await getOrgPortalTabConfig())
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
