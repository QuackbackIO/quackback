/**
 * Shared handler bodies for the status-component REST surface.
 *
 * The public-facing name for a "component" is "service" (see
 * STATUS-ADMIN-REDESIGN-SPEC.md §4 Phase 6 / §3 D4): the workspace's public
 * wording is "service", so both `/status/components*` (legacy) and
 * `/status/services*` (current) routes delegate to the functions here to stay
 * byte-identical. Only URL paths and OpenAPI docs differ between the two
 * route families — JSON payload property names (`groupId`, `componentStatus`,
 * `affectedComponents`, `segmentIds`, etc.) never change.
 *
 * Not a route itself (the `-` prefix opts it out of file-based routing).
 */
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId, parseTypeIdArray } from '@/lib/server/domains/api/validation'
import { NotFoundError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeStatusComponent } from './-serialize'
import { STATUS_COMPONENT_STATUSES, parseNullableTypeId } from './-validation'
import type { StatusComponentId, StatusComponentGroupId, SegmentId } from '@quackback/ids'
import type { StatusComponentRow } from '@/lib/server/domains/status'
import { readJsonBody } from '@/lib/server/domains/api/request'

const createComponentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(2000).nullable().optional(),
  groupId: z.string().nullable().optional(),
  status: z.enum(STATUS_COMPONENT_STATUSES).optional(),
  showUptime: z.boolean().optional(),
  segmentIds: z.array(z.string()).optional(),
})

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

/**
 * GET /api/v1/status/components (aliased at /api/v1/status/services)
 * List all status components (grouped + ungrouped), flattened into a
 * single array. Use `groupId` to reconstruct grouping client-side.
 */
export async function listStatusComponentsHandler({ request }: { request: Request }) {
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
}

/**
 * POST /api/v1/status/components (aliased at /api/v1/status/services)
 * Create a status component. Gated on the plan's `maxStatusComponents`
 * tier limit (unlimited by default — see tier-enforce.ts).
 */
export async function createStatusComponentHandler({ request }: { request: Request }) {
  try {
    await withApiKeyAuth(request, { permission: PERMISSIONS.STATUS_PAGE_MANAGE })

    const body = await readJsonBody(request)
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
    const segmentIds = parseTypeIdArray<SegmentId>(parsed.data.segmentIds, 'segment', 'segmentIds')

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
}

/** What the caller's path calls the thing: the services path says "service",
 *  the legacy components path keeps "component". */
export type ServiceNoun = 'service' | 'component'

interface ServiceRequest {
  request: Request
  id: string
  noun: ServiceNoun
}

function parseServiceId(id: string, noun: ServiceNoun): StatusComponentId {
  return parseTypeId<StatusComponentId>(id, 'status_component', `${noun} ID`)
}

function serviceNotFound(noun: ServiceNoun): Response {
  return notFoundResponse(`Status ${noun}`)
}

/** handleDomainError, with a missing service named the way the path names it. */
function serviceError(error: unknown, noun: ServiceNoun): Response {
  if (error instanceof NotFoundError && error.code === 'STATUS_COMPONENT_NOT_FOUND') {
    return serviceNotFound(noun)
  }
  return handleDomainError(error)
}

/**
 * GET /api/v1/status/components/:componentId (aliased at
 * /api/v1/status/services/:serviceId)
 */
export async function getStatusComponentHandler({ request, id, noun }: ServiceRequest) {
  try {
    await withApiKeyAuth(request)

    const componentId = parseServiceId(id, noun)

    const row = await findComponentRow(componentId)
    if (!row) return serviceNotFound(noun)

    return successResponse(serializeStatusComponent(row))
  } catch (error) {
    return serviceError(error, noun)
  }
}

/**
 * PATCH /api/v1/status/components/:componentId (aliased at
 * /api/v1/status/services/:serviceId)
 * Updates metadata (name/description/group/etc.) and/or the live
 * status in one call. A `{ status }`-only body is the primary
 * automation hook — see the schema comment above.
 */
export async function patchStatusComponentHandler({ request, id, noun }: ServiceRequest) {
  try {
    await withApiKeyAuth(request, { permission: PERMISSIONS.STATUS_PAGE_MANAGE })

    const componentId = parseServiceId(id, noun)

    const body = await readJsonBody(request)
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
        groupId: parseNullableTypeId<StatusComponentGroupId>(groupId, 'status_group', 'groupId'),
        showUptime,
        segmentIds: parseTypeIdArray<SegmentId>(segmentIds, 'segment', 'segmentIds'),
      })
    }

    if (status !== undefined) {
      await setComponentStatus(componentId, status, 'api')
    }

    const row = await findComponentRow(componentId)
    if (!row) return serviceNotFound(noun)

    return successResponse(serializeStatusComponent(row))
  } catch (error) {
    return serviceError(error, noun)
  }
}
