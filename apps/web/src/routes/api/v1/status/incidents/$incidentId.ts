import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
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

      /**
       * DELETE /api/v1/status/incidents/:incidentId
       * Soft-deletes an incident or maintenance window, as the dashboard
       * does: pending maintenance jobs are cancelled and the services it was
       * holding are recomputed from whatever is still open.
       */
      DELETE: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.STATUS_PAGE_PUBLISH })

          const incidentId = parseTypeId<StatusIncidentId>(
            params.incidentId,
            'status_incident',
            'incident ID'
          )

          const { deleteIncident } = await import('@/lib/server/domains/status')
          await deleteIncident(incidentId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
