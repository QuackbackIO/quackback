/**
 * GET    /api/v1/business-hours/:id
 * PATCH  /api/v1/business-hours/:id
 * DELETE /api/v1/business-hours/:id (archive)
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  notFoundResponse,
  forbiddenResponse,
  badRequestResponse,
  noContentResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import {
  archiveBusinessHours,
  getBusinessHours,
  updateBusinessHours,
} from '@/lib/server/domains/sla'
import type { BusinessHoursId } from '@quackback/ids'

const rangeSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
})
const scheduleSchema = z.object({
  mon: z.array(rangeSchema),
  tue: z.array(rangeSchema),
  wed: z.array(rangeSchema),
  thu: z.array(rangeSchema),
  fri: z.array(rangeSchema),
  sat: z.array(rangeSchema),
  sun: z.array(rangeSchema),
})
const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().max(200).optional(),
})

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  timezone: z.string().min(1).max(64).optional(),
  schedule: scheduleSchema.optional(),
  holidays: z.array(holidaySchema).optional(),
})

export const Route = createFileRoute('/api/v1/business-hours/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.SLA_VIEW)
          if (!hasPermission(set, PERMISSIONS.SLA_VIEW)) {
            return forbiddenResponse('sla.view permission required')
          }
          const id = parseTypeId<BusinessHoursId>(params.id, 'bizhrs', 'business hours ID')
          const row = await getBusinessHours(id)
          if (!row) return notFoundResponse('Business hours not found')
          return successResponse(row)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.BUSINESS_HOURS_MANAGE)
          if (!hasPermission(set, PERMISSIONS.BUSINESS_HOURS_MANAGE)) {
            return forbiddenResponse('business_hours.manage permission required')
          }
          const id = parseTypeId<BusinessHoursId>(params.id, 'bizhrs', 'business hours ID')
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          return successResponse(await updateBusinessHours(id, parsed.data))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.BUSINESS_HOURS_MANAGE)
          if (!hasPermission(set, PERMISSIONS.BUSINESS_HOURS_MANAGE)) {
            return forbiddenResponse('business_hours.manage permission required')
          }
          const id = parseTypeId<BusinessHoursId>(params.id, 'bizhrs', 'business hours ID')
          await archiveBusinessHours(id)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
