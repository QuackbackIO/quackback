import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serializeIncidentDetails } from '../-serialize'
import type { StatusIncidentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/status/incidents/$incidentId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/status/incidents/:incidentId
       * Full (admin/unfiltered) incident or maintenance-window detail,
       * including its update timeline.
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request)

          const incidentId = parseTypeId<StatusIncidentId>(
            params.incidentId,
            'status_incident',
            'incident ID'
          )

          const { getStatusIncidentById } = await import('@/lib/server/domains/status')
          const incident = await getStatusIncidentById(incidentId)

          return successResponse(serializeIncidentDetails(incident))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
