/**
 * GET  /api/v1/sla-policies — list policies
 * POST /api/v1/sla-policies — create policy
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
import { createSlaPolicy, listSlaPolicies } from '@/lib/server/domains/sla'
import { SLA_POLICY_SCOPES, TICKET_PRIORITIES } from '@/lib/server/db'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
  scope: z.enum(SLA_POLICY_SCOPES),
  scopeTeamId: z.string().nullable().optional(),
  scopeInboxId: z.string().nullable().optional(),
  appliesToPriorities: z.array(z.enum(TICKET_PRIORITIES)).optional(),
  businessHoursId: z.string().nullable().optional(),
  pauseOnPending: z.boolean().optional(),
  pauseOnOnHold: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/sla-policies/')({
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
          return successResponse(await listSlaPolicies({ includeArchived }))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.SLA_MANAGE)
          if (!hasPermission(set, PERMISSIONS.SLA_MANAGE)) {
            return forbiddenResponse('sla.manage permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = createSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const policy = await createSlaPolicy(parsed.data as never)
          return createdResponse(policy)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
