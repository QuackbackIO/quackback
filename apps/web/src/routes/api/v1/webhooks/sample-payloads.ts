import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'

export const Route = createFileRoute('/api/v1/webhooks/sample-payloads')({
  server: {
    handlers: {
      /**
       * GET /api/v1/webhooks/sample-payloads
       *
       * Returns the canonical sample payload for every supported event type,
       * keyed by event id. Used by the create/edit dialog to render a
       * payload-preview accordion next to each event picker row.
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { role: 'admin' })
          const { getAllSampleEventPayloads } = await import('@/lib/server/events/sample-payloads')
          return successResponse(getAllSampleEventPayloads())
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
