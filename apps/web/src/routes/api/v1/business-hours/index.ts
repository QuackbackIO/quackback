/**
 * GET  /api/v1/business-hours — list calendars
 * POST /api/v1/business-hours — create calendar
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { createBusinessHours, listBusinessHours } from '@/lib/server/domains/sla'

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

const createSchema = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().min(1).max(64).optional(),
  schedule: scheduleSchema,
  holidays: z.array(holidaySchema).optional(),
})

export const Route = createFileRoute('/api/v1/business-hours/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.SLA_VIEW)
          if (!hasPermission(set, PERMISSIONS.SLA_VIEW)) {
            return forbiddenResponse('sla.view permission required')
          }
          const url = new URL(request.url)
          const includeArchived = url.searchParams.get('includeArchived') === 'true'
          return successResponse(await listBusinessHours({ includeArchived }))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.BUSINESS_HOURS_MANAGE)
          if (!hasPermission(set, PERMISSIONS.BUSINESS_HOURS_MANAGE)) {
            return forbiddenResponse('business_hours.manage permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = createSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const row = await createBusinessHours(parsed.data)
          return createdResponse(row)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
