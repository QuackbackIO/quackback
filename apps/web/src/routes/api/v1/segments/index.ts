/**
 * GET  /api/v1/segments — list audience segments (with member counts)
 * POST /api/v1/segments — create a segment (manual or dynamic)
 *
 * Scope-gated with the segment.* permissions (config-plane): the API key must
 * carry the scope AND the calling principal must hold the permission.
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
import { createSegmentSchema } from '@/lib/shared/schemas/segments'
import { serializeSegment } from './-serialize'

export const Route = createFileRoute('/api/v1/segments/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.SEGMENT_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.SEGMENT_VIEW)) {
            return forbiddenResponse('segment.view permission required')
          }
          const { listSegments } = await import('@/lib/server/domains/segments/segment.service')
          const rows = await listSegments()
          return successResponse(rows.map(serializeSegment))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.SEGMENT_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.SEGMENT_MANAGE)) {
            return forbiddenResponse('segment.manage permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = createSegmentSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { createSegment } = await import('@/lib/server/domains/segments/segment.service')
          const segment = await createSegment(parsed.data)
          return createdResponse(serializeSegment(segment))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
