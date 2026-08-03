/**
 * GET   /api/v1/settings/features — read workspace feature flags
 * PATCH /api/v1/settings/features — toggle feature flags
 *
 * Gated by admin.manage_settings.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'

const featureFlagsSchema = z
  .object({
    helpCenter: z.boolean(),
    aiFeedbackExtraction: z.boolean(),
    tickets: z.boolean(),
    supportInbox: z.boolean(),
    linkPreviews: z.boolean(),
  })
  .partial()

export const Route = createFileRoute('/api/v1/settings/features')({
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
          const { getFeatureFlags } = await import('@/lib/server/domains/settings/settings.service')
          return successResponse(await getFeatureFlags())
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
          const parsed = featureFlagsSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { updateFeatureFlags } =
            await import('@/lib/server/domains/settings/settings.service')
          return successResponse(await updateFeatureFlags(parsed.data))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
