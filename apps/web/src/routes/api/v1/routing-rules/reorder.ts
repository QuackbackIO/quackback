/**
 * POST /api/v1/routing-rules/reorder — replace ordering by passing all rule
 * IDs in desired evaluation order.
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
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { reorderRoutingRules } from '@/lib/server/domains/inboxes'
import type { RoutingRuleId } from '@quackback/ids'

const schema = z.object({ orderedIds: z.array(z.string().min(1)).min(1) })

export const Route = createFileRoute('/api/v1/routing-rules/reorder')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ROUTING_RULE_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ROUTING_RULE_MANAGE)) {
            return forbiddenResponse('routing.rule.manage permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = schema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          await reorderRoutingRules(parsed.data.orderedIds as RoutingRuleId[])
          return successResponse({ ok: true })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
