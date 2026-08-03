/**
 * GET    /api/v1/routing-rules/:ruleId
 * PATCH  /api/v1/routing-rules/:ruleId
 * DELETE /api/v1/routing-rules/:ruleId
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
import { deleteRoutingRule, getRoutingRule, updateRoutingRule } from '@/lib/server/domains/inboxes'
import type { RoutingRuleId } from '@quackback/ids'

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  conditions: z.unknown().optional(),
  actions: z.unknown().optional(),
  inboxIdScope: z.string().nullable().optional(),
})

export const Route = createFileRoute('/api/v1/routing-rules/$ruleId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ROUTING_RULE_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ROUTING_RULE_MANAGE)) {
            return forbiddenResponse('routing.rule.manage permission required')
          }
          const id = parseTypeId<RoutingRuleId>(params.ruleId, 'route_rule', 'rule ID')
          const rule = await getRoutingRule(id)
          if (!rule) return notFoundResponse('Rule not found')
          return successResponse(rule)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ROUTING_RULE_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ROUTING_RULE_MANAGE)) {
            return forbiddenResponse('routing.rule.manage permission required')
          }
          const id = parseTypeId<RoutingRuleId>(params.ruleId, 'route_rule', 'rule ID')
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          return successResponse(await updateRoutingRule(id, parsed.data as never))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ROUTING_RULE_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ROUTING_RULE_MANAGE)) {
            return forbiddenResponse('routing.rule.manage permission required')
          }
          const id = parseTypeId<RoutingRuleId>(params.ruleId, 'route_rule', 'rule ID')
          await deleteRoutingRule(id)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
