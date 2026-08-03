/**
 * GET /api/v1/changelog/visibility/segments — list every per-segment changelog
 * visibility override (with the segment name for convenience).
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'

export const Route = createFileRoute('/api/v1/changelog/visibility/segments')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })
          const { getAllSegmentChangelogVisibilities } =
            await import('@/lib/server/domains/changelog/changelog-visibility.service')
          const rows = await getAllSegmentChangelogVisibilities()
          return successResponse(rows)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
