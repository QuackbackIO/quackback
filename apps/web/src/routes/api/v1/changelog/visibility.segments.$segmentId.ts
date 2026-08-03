/**
 * GET    /api/v1/changelog/visibility/segments/:segmentId — read one override
 * PUT    /api/v1/changelog/visibility/segments/:segmentId — upsert one override
 * DELETE /api/v1/changelog/visibility/segments/:segmentId — remove the override
 *
 * Per-segment changelog visibility overrides. Role-gated (team read, admin
 * write) like the rest of the changelog feedback-plane surface.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { changelogVisibilityConfigSchema } from '@/lib/shared/schemas/changelog-visibility'
import type { SegmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/changelog/visibility/segments/$segmentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })
          const segmentId = parseTypeId<SegmentId>(params.segmentId, 'segment', 'segment ID')
          const { getSegmentChangelogVisibility } =
            await import('@/lib/server/domains/changelog/changelog-visibility.service')
          const config = await getSegmentChangelogVisibility(segmentId)
          if (!config) return notFoundResponse('Segment changelog visibility override')
          return successResponse({ segmentId, config })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PUT: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'admin' })
          const segmentId = parseTypeId<SegmentId>(params.segmentId, 'segment', 'segment ID')
          const body = await request.json().catch(() => null)
          const parsed = changelogVisibilityConfigSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { setSegmentChangelogVisibility, getSegmentChangelogVisibility } =
            await import('@/lib/server/domains/changelog/changelog-visibility.service')
          await setSegmentChangelogVisibility(segmentId, parsed.data)
          return successResponse({
            segmentId,
            config: await getSegmentChangelogVisibility(segmentId),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'admin' })
          const segmentId = parseTypeId<SegmentId>(params.segmentId, 'segment', 'segment ID')
          const { deleteSegmentChangelogVisibility } =
            await import('@/lib/server/domains/changelog/changelog-visibility.service')
          await deleteSegmentChangelogVisibility(segmentId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
