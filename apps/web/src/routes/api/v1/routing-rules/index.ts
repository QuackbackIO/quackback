/**
 * GET  /api/v1/routing-rules — list rules
 * POST /api/v1/routing-rules — create rule
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
import { createRoutingRule, listRoutingRules } from '@/lib/server/domains/inboxes'
import type { InboxId } from '@quackback/ids'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  conditions: z.unknown(),
  actions: z.unknown(),
  inboxIdScope: z.string().nullable().optional(),
})

export const Route = createFileRoute('/api/v1/routing-rules/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ROUTING_RULE_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ROUTING_RULE_MANAGE)) {
            return forbiddenResponse('routing.rule.manage permission required')
          }
          const url = new URL(request.url)
          const inboxIdScopeRaw = url.searchParams.get('inboxIdScope') ?? undefined
          const enabledOnly = url.searchParams.get('enabledOnly') === 'true'
          const inboxIdScope =
            inboxIdScopeRaw === 'workspace' ? 'workspace' : (inboxIdScopeRaw as InboxId | undefined)
          return successResponse(await listRoutingRules({ inboxIdScope, enabledOnly }))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ROUTING_RULE_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ROUTING_RULE_MANAGE)) {
            return forbiddenResponse('routing.rule.manage permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = createSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const rule = await createRoutingRule(parsed.data as never)
          return createdResponse(rule)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
