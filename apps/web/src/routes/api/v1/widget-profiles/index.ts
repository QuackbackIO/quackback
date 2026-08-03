/**
 * GET  /api/v1/widget-profiles — list widget applications (with environment profiles)
 * POST /api/v1/widget-profiles — create or update a widget application
 *
 * Config-plane resource: the API key must carry the widget.* scope AND the
 * calling principal must hold the corresponding permission.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  forbiddenResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { upsertWidgetApplicationSchema } from '@/lib/shared/schemas/widget-profiles'
import { serializeWidgetApplication, serializeWidgetApplicationWithProfiles } from './-serialize'

export const Route = createFileRoute('/api/v1/widget-profiles/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.WIDGET_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.WIDGET_VIEW)) {
            return forbiddenResponse('widget.view permission required')
          }
          const { listWidgetApplications } =
            await import('@/lib/server/domains/widget-profiles/widget-profile.service')
          const rows = await listWidgetApplications()
          return successResponse(rows.map(serializeWidgetApplicationWithProfiles))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.WIDGET_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.WIDGET_MANAGE)) {
            return forbiddenResponse('widget.manage permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = upsertWidgetApplicationSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { upsertWidgetApplication } =
            await import('@/lib/server/domains/widget-profiles/widget-profile.service')
          const application = await upsertWidgetApplication(parsed.data)
          if (!application) return notFoundResponse('Widget application')
          return createdResponse(serializeWidgetApplication(application))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
