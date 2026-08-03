/**
 * PATCH  /api/v1/sla-policies/:policyId/escalation-rules/:ruleId
 * DELETE /api/v1/sla-policies/:policyId/escalation-rules/:ruleId
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  badRequestResponse,
  noContentResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { deleteEscalationRule, updateEscalationRule } from '@/lib/server/domains/sla'
import { SLA_TARGET_KINDS, ESCALATION_RECIPIENT_TYPES, ESCALATION_CHANNELS } from '@/lib/server/db'
import type { EscalationRuleId } from '@quackback/ids'

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  leadMinutes: z.number().int().optional(),
  targetKind: z.enum(SLA_TARGET_KINDS).optional(),
  recipientType: z.enum(ESCALATION_RECIPIENT_TYPES).optional(),
  recipientTeamId: z.string().nullable().optional(),
  recipientPrincipalIds: z.array(z.string()).optional(),
  channels: z.array(z.enum(ESCALATION_CHANNELS)).optional(),
  enabled: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/sla-policies/$policyId/escalation-rules/$ruleId')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ESCALATION_RULE_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ESCALATION_RULE_MANAGE)) {
            return forbiddenResponse('escalation.rule_manage permission required')
          }
          const id = parseTypeId<EscalationRuleId>(params.ruleId, 'esc_rule', 'rule ID')
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          return successResponse(await updateEscalationRule(id, parsed.data as never))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ESCALATION_RULE_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ESCALATION_RULE_MANAGE)) {
            return forbiddenResponse('escalation.rule_manage permission required')
          }
          const id = parseTypeId<EscalationRuleId>(params.ruleId, 'esc_rule', 'rule ID')
          await deleteEscalationRule(id)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
