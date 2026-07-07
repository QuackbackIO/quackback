/**
 * GET  /api/v1/sla-policies/:policyId/escalation-rules
 * POST /api/v1/sla-policies/:policyId/escalation-rules
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
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { createEscalationRule, listEscalationRulesForPolicy } from '@/lib/server/domains/sla'
import { SLA_TARGET_KINDS, ESCALATION_RECIPIENT_TYPES, ESCALATION_CHANNELS } from '@/lib/server/db'
import type { SlaPolicyId } from '@quackback/ids'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  leadMinutes: z.number().int(),
  targetKind: z.enum(SLA_TARGET_KINDS),
  recipientType: z.enum(ESCALATION_RECIPIENT_TYPES),
  recipientTeamId: z.string().nullable().optional(),
  recipientPrincipalIds: z.array(z.string()).optional(),
  channels: z.array(z.enum(ESCALATION_CHANNELS)).optional(),
  enabled: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/sla-policies/$policyId/escalation-rules')({
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
          return successResponse(await listEscalationRulesForPolicy(id))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ESCALATION_RULE_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ESCALATION_RULE_MANAGE)) {
            return forbiddenResponse('escalation.rule_manage permission required')
          }
          const id = parseTypeId<SlaPolicyId>(params.policyId, 'sla_pol', 'policy ID')
          const body = await request.json().catch(() => null)
          const parsed = createSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const rule = await createEscalationRule({
            ...(parsed.data as Record<string, unknown>),
            policyId: id,
          } as never)
          return createdResponse(rule)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
