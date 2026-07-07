import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeIdArray } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeStatusComponent } from '../-serialize'
import { STATUS_COMPONENT_STATUSES, parseNullableTypeId } from '../-validation'
import type { StatusComponentGroupId, SegmentId } from '@quackback/ids'

const createComponentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(2000).nullable().optional(),
  groupId: z.string().nullable().optional(),
  status: z.enum(STATUS_COMPONENT_STATUSES).optional(),
  showUptime: z.boolean().optional(),
  segmentIds: z.array(z.string()).optional(),
})

export const Route = createFileRoute('/api/v1/status/components/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/status/components
       * List all status components (grouped + ungrouped), flattened into a
       * single array. Use `groupId` to reconstruct grouping client-side.
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request)

          const { listStatusComponentGroupsWithComponents, listUngroupedStatusComponents } =
            await import('@/lib/server/domains/status')

          const [groups, ungrouped] = await Promise.all([
            listStatusComponentGroupsWithComponents(),
            listUngroupedStatusComponents(),
          ])

          const components = [...groups.flatMap((g) => g.components), ...ungrouped]

          return successResponse(components.map(serializeStatusComponent))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/status/components
       * Create a status component. Gated on the plan's `maxStatusComponents`
       * tier limit (unlimited by default — see tier-enforce.ts).
       */
      POST: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.STATUS_PAGE_MANAGE })

          const body = await request.json()
          const parsed = createComponentSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const groupId = parseNullableTypeId<StatusComponentGroupId>(
            parsed.data.groupId,
            'status_group',
            'groupId'
          )
          const segmentIds = parseTypeIdArray<SegmentId>(
            parsed.data.segmentIds,
            'segment',
            'segmentIds'
          )

          const { enforceStatusComponentLimit } =
            await import('@/lib/server/domains/settings/tier-enforce')
          await enforceStatusComponentLimit()

          const { createStatusComponent } = await import('@/lib/server/domains/status')

          const component = await createStatusComponent({
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            groupId,
            status: parsed.data.status,
            showUptime: parsed.data.showUptime,
            segmentIds,
          })

          return createdResponse(serializeStatusComponent(component))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
