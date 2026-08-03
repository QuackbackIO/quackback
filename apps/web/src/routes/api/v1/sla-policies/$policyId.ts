/**
 * GET    /api/v1/sla-policies/:policyId
 * PATCH  /api/v1/sla-policies/:policyId
 * DELETE /api/v1/sla-policies/:policyId (archive)
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
  archiveSlaPolicy,
  getSlaPolicy,
  listEscalationRulesForPolicy,
  listTargetsForPolicy,
  updateSlaPolicy,
} from '@/lib/server/domains/sla'
import { TICKET_PRIORITIES } from '@/lib/server/db'
import type { SlaPolicyId } from '@quackback/ids'

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
  appliesToPriorities: z.array(z.enum(TICKET_PRIORITIES)).optional(),
  businessHoursId: z.string().nullable().optional(),
  pauseOnPending: z.boolean().optional(),
  pauseOnOnHold: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/sla-policies/$policyId')({
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
          const id = parseTypeId<SlaPolicyId>(params.policyId, 'sla_pol', 'policy ID')
          const policy = await getSlaPolicy(id)
          if (!policy) return notFoundResponse('Policy not found')
          const targets = await listTargetsForPolicy(id)
          const escalations = await listEscalationRulesForPolicy(id)
          return successResponse({ policy, targets, escalations })
        } catch (error) {
          return handleDomainError(error)
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.SLA_MANAGE)
          if (!hasPermission(set, PERMISSIONS.SLA_MANAGE)) {
            return forbiddenResponse('sla.manage permission required')
          }
          const id = parseTypeId<SlaPolicyId>(params.policyId, 'sla_pol', 'policy ID')
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          return successResponse(await updateSlaPolicy(id, parsed.data as never))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.SLA_MANAGE)
          if (!hasPermission(set, PERMISSIONS.SLA_MANAGE)) {
            return forbiddenResponse('sla.manage permission required')
          }
          const id = parseTypeId<SlaPolicyId>(params.policyId, 'sla_pol', 'policy ID')
          await archiveSlaPolicy(id)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
