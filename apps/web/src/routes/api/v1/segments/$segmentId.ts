/**
 * GET    /api/v1/segments/:segmentId — fetch one segment
 * PATCH  /api/v1/segments/:segmentId — update a segment
 * DELETE /api/v1/segments/:segmentId — soft-delete a segment
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
import { updateSegmentBodySchema } from '@/lib/shared/schemas/segments'
import { serializeSegment } from './-serialize'
import type { SegmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/segments/$segmentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.SEGMENT_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.SEGMENT_VIEW)) {
            return forbiddenResponse('segment.view permission required')
          }
          const segmentId = parseTypeId<SegmentId>(params.segmentId, 'segment', 'segment ID')
          const { getSegment } = await import('@/lib/server/domains/segments/segment.service')
          const segment = await getSegment(segmentId)
          if (!segment) return notFoundResponse('Segment')
          return successResponse(serializeSegment(segment))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.SEGMENT_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.SEGMENT_MANAGE)) {
            return forbiddenResponse('segment.manage permission required')
          }
          const segmentId = parseTypeId<SegmentId>(params.segmentId, 'segment', 'segment ID')
          const body = await request.json().catch(() => null)
          const parsed = updateSegmentBodySchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { updateSegment } = await import('@/lib/server/domains/segments/segment.service')
          const segment = await updateSegment(segmentId, parsed.data)
          return successResponse(serializeSegment(segment))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.SEGMENT_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.SEGMENT_MANAGE)) {
            return forbiddenResponse('segment.manage permission required')
          }
          const segmentId = parseTypeId<SegmentId>(params.segmentId, 'segment', 'segment ID')
          const { deleteSegment } = await import('@/lib/server/domains/segments/segment.service')
          await deleteSegment(segmentId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
