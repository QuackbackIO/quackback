/**
 * GET /api/v1/audit-events — paginated list of audit events.
 *
 * Requires API key with `audit.view` scope (or legacy compat key).
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
import { listAuditEvents } from '@/lib/server/domains/audit'
import type { PrincipalId } from '@quackback/ids'

const querySchema = z.object({
  principalId: z.string().optional(),
  action: z.string().optional(),
  actionPrefix: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  source: z.enum(['web', 'api', 'integration', 'system', 'mcp']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const Route = createFileRoute('/api/v1/audit-events/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.AUDIT_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.AUDIT_VIEW)
          if (!hasPermission(set, PERMISSIONS.AUDIT_VIEW)) {
            return forbiddenResponse('audit.view permission required')
          }
          const url = new URL(request.url)
          const params = Object.fromEntries(url.searchParams.entries())
          const parsed = querySchema.safeParse(params)
          if (!parsed.success) {
            return badRequestResponse('Invalid query parameters', { issues: parsed.error.issues })
          }
          const data = parsed.data
          const page = await listAuditEvents({
            principalId: data.principalId as PrincipalId | undefined,
            action: data.action,
            actionPrefix: data.actionPrefix,
            targetType: data.targetType,
            targetId: data.targetId,
            source: data.source,
            from: data.from ? new Date(data.from) : undefined,
            to: data.to ? new Date(data.to) : undefined,
            cursor: data.cursor,
            limit: data.limit,
          })
          return successResponse(page)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
