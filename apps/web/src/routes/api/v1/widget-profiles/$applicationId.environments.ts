/**
 * POST /api/v1/widget-profiles/:applicationId/environments — create an environment profile
 * PUT  /api/v1/widget-profiles/:applicationId/environments — create or update an environment profile
 *
 * Config-plane resource: the API key must carry the widget.manage scope AND
 * the calling principal must hold widget.manage. The application is identified
 * by the path param; the body carries the environment profile fields.
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
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { upsertWidgetEnvironmentProfileBodySchema } from '@/lib/shared/schemas/widget-profiles'
import { serializeWidgetEnvironmentProfile } from './-serialize'
import type { WidgetApplicationId } from '@quackback/ids'

async function upsertProfileHandler(
  request: Request,
  params: { applicationId: string },
  created: boolean
): Promise<Response> {
  try {
    const auth = await withApiKeyAuth(request, { role: 'team' })
    assertScopeAllowed(auth, PERMISSIONS.WIDGET_MANAGE)
    const set = await loadPermissionSet(auth.principalId)
    if (!hasPermission(set, PERMISSIONS.WIDGET_MANAGE)) {
      return forbiddenResponse('widget.manage permission required')
    }
    const applicationId = parseTypeId<WidgetApplicationId>(
      params.applicationId,
      'widget_app',
      'application ID'
    )
    const body = await request.json().catch(() => null)
    const parsed = upsertWidgetEnvironmentProfileBodySchema.safeParse(body)
    if (!parsed.success) {
      return badRequestResponse('Invalid request body', {
        errors: parsed.error.flatten().fieldErrors,
      })
    }
    const { upsertWidgetEnvironmentProfile } =
      await import('@/lib/server/domains/widget-profiles/widget-profile.service')
    const profile = await upsertWidgetEnvironmentProfile({
      ...parsed.data,
      applicationId,
    })
    if (!profile) return notFoundResponse('Widget environment profile')
    const payload = serializeWidgetEnvironmentProfile(profile)
    return created ? createdResponse(payload) : successResponse(payload)
  } catch (error) {
    return handleDomainError(error)
  }
}

export const Route = createFileRoute('/api/v1/widget-profiles/$applicationId/environments')({
  server: {
    handlers: {
      POST: async ({ request, params }) => upsertProfileHandler(request, params, true),
      PUT: async ({ request, params }) => upsertProfileHandler(request, params, false),
    },
  },
})
