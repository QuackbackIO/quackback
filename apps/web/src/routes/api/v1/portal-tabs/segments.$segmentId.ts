/**
 * GET    /api/v1/portal-tabs/segments/:segmentId — read a segment's tab overrides
 * PUT    /api/v1/portal-tabs/segments/:segmentId — set/replace a segment's tab overrides
 * DELETE /api/v1/portal-tabs/segments/:segmentId — remove a segment's overrides (revert to org defaults)
 *
 * Config-plane resource: scope-gated with portal.manage for read and write.
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
import { portalTabConfigSchema } from '@/lib/shared/schemas/portal-tabs'
import type { SegmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/portal-tabs/segments/$segmentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.PORTAL_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.PORTAL_MANAGE)) {
            return forbiddenResponse('portal.manage permission required')
          }
          const segmentId = parseTypeId<SegmentId>(params.segmentId, 'segment', 'segment ID')
          const { getSegmentTabOverrides } =
            await import('@/lib/server/domains/portal/index.server')
          const config = await getSegmentTabOverrides(segmentId)
          if (!config) return notFoundResponse('Segment tab overrides')
          return successResponse(config)
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PUT: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.PORTAL_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.PORTAL_MANAGE)) {
            return forbiddenResponse('portal.manage permission required')
          }
          const segmentId = parseTypeId<SegmentId>(params.segmentId, 'segment', 'segment ID')
          const body = await request.json().catch(() => null)
          const parsed = portalTabConfigSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { setSegmentTabOverrides, getSegmentTabOverrides } =
            await import('@/lib/server/domains/portal/index.server')
          await setSegmentTabOverrides(segmentId, parsed.data)
          return successResponse(await getSegmentTabOverrides(segmentId))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.PORTAL_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.PORTAL_MANAGE)) {
            return forbiddenResponse('portal.manage permission required')
          }
          const segmentId = parseTypeId<SegmentId>(params.segmentId, 'segment', 'segment ID')
          const { deleteSegmentTabOverrides } =
            await import('@/lib/server/domains/portal/index.server')
          await deleteSegmentTabOverrides(segmentId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
