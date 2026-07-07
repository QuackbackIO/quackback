import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId, parseTypeIdArray } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeStatusComponent } from '../-serialize'
import { STATUS_COMPONENT_STATUSES, parseNullableTypeId } from '../-validation'
import type { StatusComponentId, StatusComponentGroupId, SegmentId } from '@quackback/ids'
import type { StatusComponentRow } from '@/lib/server/domains/status'

const patchComponentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  groupId: z.string().nullable().optional(),
  showUptime: z.boolean().optional(),
  segmentIds: z.array(z.string()).optional(),
  // The monitoring-tool automation hook: a webhook from Datadog, Pingdom,
  // etc. drives a component's live status via `{ status }` alone.
  status: z.enum(STATUS_COMPONENT_STATUSES).optional(),
})

async function findComponentRow(
  componentId: StatusComponentId
): Promise<StatusComponentRow | null> {
  const { db, eq, and, isNull, statusComponents } = await import('@/lib/server/db')
  const row = await db.query.statusComponents.findFirst({
    where: and(eq(statusComponents.id, componentId), isNull(statusComponents.deletedAt)),
  })
  if (!row) return null
  return {
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    description: row.description,
    status: row.status,
    position: row.position,
    showUptime: row.showUptime,
    segmentIds: row.segmentIds,
  }
}

export const Route = createFileRoute('/api/v1/status/components/$componentId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/status/components/:componentId
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request)

          const componentId = parseTypeId<StatusComponentId>(
            params.componentId,
            'status_component',
            'component ID'
          )

          const row = await findComponentRow(componentId)
          if (!row) return notFoundResponse('Status component')

          return successResponse(serializeStatusComponent(row))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/status/components/:componentId
       * Updates metadata (name/description/group/etc.) and/or the live
       * status in one call. A `{ status }`-only body is the primary
       * automation hook — see the schema comment above.
       */
      PATCH: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.STATUS_PAGE_MANAGE })

          const componentId = parseTypeId<StatusComponentId>(
            params.componentId,
            'status_component',
            'component ID'
          )

          const body = await request.json()
          const parsed = patchComponentSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { status, name, description, groupId, showUptime, segmentIds } = parsed.data
          const hasMetadataUpdate =
            name !== undefined ||
            description !== undefined ||
            groupId !== undefined ||
            showUptime !== undefined ||
            segmentIds !== undefined

          if (!hasMetadataUpdate && status === undefined) {
            return badRequestResponse('At least one field is required')
          }

          const { updateStatusComponent, setComponentStatus } =
            await import('@/lib/server/domains/status')

          if (hasMetadataUpdate) {
            await updateStatusComponent(componentId, {
              name,
              description,
              groupId: parseNullableTypeId<StatusComponentGroupId>(
                groupId,
                'status_group',
                'groupId'
              ),
              showUptime,
              segmentIds: parseTypeIdArray<SegmentId>(segmentIds, 'segment', 'segmentIds'),
            })
          }

          if (status !== undefined) {
            await setComponentStatus(componentId, status, 'api')
          }

          const row = await findComponentRow(componentId)
          if (!row) return notFoundResponse('Status component')

          return successResponse(serializeStatusComponent(row))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
