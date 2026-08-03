import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  handleDomainError,
  decodeCursor,
  encodeCursor,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { listContactsForOrganization } from '@/lib/server/domains/organizations'
import type { OrganizationId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/organizations/$organizationId/contacts')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ORG_VIEW)
          if (!hasPermission(set, PERMISSIONS.ORG_VIEW)) {
            return forbiddenResponse('org.view permission required')
          }
          const id = parseTypeId<OrganizationId>(params.organizationId, 'org', 'organization ID')
          const url = new URL(request.url)
          const includeArchived = url.searchParams.get('includeArchived') === 'true'
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
          const offset = decodeCursor(url.searchParams.get('cursor') ?? undefined)
          const items = await listContactsForOrganization(id, {
            includeArchived,
            limit: limit + 1,
            offset,
          })
          const hasMore = items.length > limit
          const page = hasMore ? items.slice(0, limit) : items
          const nextCursor = hasMore ? encodeCursor(offset + limit) : null
          return successResponse(page, { pagination: { cursor: nextCursor, hasMore } })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
