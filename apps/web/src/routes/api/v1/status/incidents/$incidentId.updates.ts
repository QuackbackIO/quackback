import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeIncidentDetails } from '../-serialize'
import { STATUS_INCIDENT_LIFECYCLE_STATUSES } from '../-validation'
import type { StatusIncidentId } from '@quackback/ids'

const postIncidentUpdateSchema = z.object({
  status: z.enum(STATUS_INCIDENT_LIFECYCLE_STATUSES),
  body: z.string().min(1, 'Update body is required'),
  skipRestore: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/status/incidents/$incidentId/updates')({
  server: {
    handlers: {
      /**
       * POST /api/v1/status/incidents/:incidentId/updates
       * Post a new lifecycle update (status change) to an incident or
       * maintenance window. A terminal status (resolved/completed) restores
       * its affected components to operational, unless `skipRestore` is set
       * (partial-recovery case).
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.STATUS_PAGE_PUBLISH,
          })

          const incidentId = parseTypeId<StatusIncidentId>(
            params.incidentId,
            'status_incident',
            'incident ID'
          )

          const body = await request.json()
          const parsed = postIncidentUpdateSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { postIncidentUpdate } = await import('@/lib/server/domains/status')
          const incident = await postIncidentUpdate(incidentId, parsed.data, {
            principalId: auth.principalId,
          })

          return createdResponse(serializeIncidentDetails(incident))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
