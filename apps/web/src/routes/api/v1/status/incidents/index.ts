import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeIncidentDetails } from '../-serialize'
import {
  STATUS_COMPONENT_STATUSES,
  STATUS_INCIDENT_IMPACTS,
  STATUS_INCIDENT_LIFECYCLE_STATUSES,
  parseOptionalDate,
} from '../-validation'
import type { StatusComponentId } from '@quackback/ids'

const affectedComponentSchema = z.object({
  componentId: z.string(),
  componentStatus: z.enum(STATUS_COMPONENT_STATUSES),
})

const createIncidentSchema = z.object({
  kind: z.enum(['incident', 'maintenance']),
  title: z.string().min(1, 'Title is required').max(200),
  status: z.enum(STATUS_INCIDENT_LIFECYCLE_STATUSES),
  impact: z.enum(STATUS_INCIDENT_IMPACTS).optional(),
  impactOverride: z.boolean().optional(),
  affectedComponents: z
    .array(affectedComponentSchema)
    .min(1, 'At least one affected component is required'),
  body: z.string().min(1, 'Update body is required'),
  scheduledStartAt: z.string().datetime().nullable().optional(),
  scheduledEndAt: z.string().datetime().nullable().optional(),
  autoStart: z.boolean().optional(),
  autoComplete: z.boolean().optional(),
  backfill: z
    .object({
      startedAt: z.string().datetime(),
      resolvedAt: z.string().datetime(),
    })
    .optional(),
  notifySubscribers: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/status/incidents/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/status/incidents
       * List incidents and maintenance windows (admin/unfiltered detail).
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request)

          const url = new URL(request.url)
          const kindParam = url.searchParams.get('kind')
          const stateParam = url.searchParams.get('state')
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)

          const kind =
            kindParam === 'incident' || kindParam === 'maintenance' ? kindParam : undefined
          const state =
            stateParam === 'active' || stateParam === 'resolved' || stateParam === 'all'
              ? stateParam
              : undefined

          const { listStatusIncidents } = await import('@/lib/server/domains/status')
          const result = await listStatusIncidents({ kind, state, cursor, limit })

          return successResponse(result.items.map(serializeIncidentDetails), {
            pagination: { cursor: result.nextCursor, hasMore: result.hasMore },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/status/incidents
       * Create an incident or a scheduled maintenance window, publishing it
       * (and notifying subscribers, unless `notifySubscribers: false`) under
       * the API key holder's principal.
       */
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.STATUS_PAGE_PUBLISH,
          })

          const body = await request.json()
          const parsed = createIncidentSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const affectedComponents = parsed.data.affectedComponents.map((c) => ({
            componentId: parseTypeId<StatusComponentId>(
              c.componentId,
              'status_component',
              'affectedComponents[].componentId'
            ),
            componentStatus: c.componentStatus,
          }))

          const { createIncident } = await import('@/lib/server/domains/status')

          const incident = await createIncident(
            {
              kind: parsed.data.kind,
              title: parsed.data.title,
              status: parsed.data.status,
              impact: parsed.data.impact,
              impactOverride: parsed.data.impactOverride,
              affectedComponents,
              body: parsed.data.body,
              scheduledStartAt: parseOptionalDate(parsed.data.scheduledStartAt),
              scheduledEndAt: parseOptionalDate(parsed.data.scheduledEndAt),
              autoStart: parsed.data.autoStart,
              autoComplete: parsed.data.autoComplete,
              backfill: parsed.data.backfill
                ? {
                    startedAt: new Date(parsed.data.backfill.startedAt),
                    resolvedAt: new Date(parsed.data.backfill.resolvedAt),
                  }
                : undefined,
              notifySubscribers: parsed.data.notifySubscribers,
            },
            { principalId: auth.principalId }
          )

          return createdResponse(serializeIncidentDetails(incident))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
