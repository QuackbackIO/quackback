/**
 * GET /api/v1/sla-policies/:policyId/targets — list targets
 * PUT /api/v1/sla-policies/:policyId/targets — replace target set
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { listTargetsForPolicy, replaceTargets } from '@/lib/server/domains/sla'
import { SLA_TARGET_KINDS } from '@/lib/server/db'
import type { SlaPolicyId } from '@quackback/ids'

const putSchema = z.object({
  targets: z.array(
    z.object({
      kind: z.enum(SLA_TARGET_KINDS),
      minutes: z.number().int().positive(),
    })
  ),
})

export const Route = createFileRoute('/api/v1/sla-policies/$policyId/targets')({
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
          return successResponse(await listTargetsForPolicy(id))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      PUT: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.SLA_MANAGE)
          if (!hasPermission(set, PERMISSIONS.SLA_MANAGE)) {
            return forbiddenResponse('sla.manage permission required')
          }
          const id = parseTypeId<SlaPolicyId>(params.policyId, 'sla_pol', 'policy ID')
          const body = await request.json().catch(() => null)
          const parsed = putSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          return successResponse(await replaceTargets(id, parsed.data.targets))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
