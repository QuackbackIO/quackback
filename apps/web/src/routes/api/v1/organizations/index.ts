import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
  decodeCursor,
  encodeCursor,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { createOrganization, listOrganizations } from '@/lib/server/domains/organizations'
import { recordEvent } from '@/lib/server/domains/audit'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(255).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

export const Route = createFileRoute('/api/v1/organizations/')({
  server: {
    handlers: {
      /** GET /api/v1/organizations — list with cursor pagination + search */
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ORG_VIEW)
          if (!hasPermission(set, PERMISSIONS.ORG_VIEW)) {
            return forbiddenResponse('org.view permission required')
          }
          const url = new URL(request.url)
          const search = url.searchParams.get('search') ?? undefined
          const includeArchived = url.searchParams.get('includeArchived') === 'true'
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
          const offset = decodeCursor(cursor)
          const items = await listOrganizations({
            search,
            includeArchived,
            limit: limit + 1,
            offset,
          })
          const hasMore = items.length > limit
          const page = hasMore ? items.slice(0, limit) : items
          const nextCursor = hasMore ? encodeCursor(offset + limit) : null
          return successResponse(page, {
            pagination: { cursor: nextCursor, hasMore },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
      /** POST /api/v1/organizations — create */
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ORG_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ORG_MANAGE)) {
            return forbiddenResponse('org.manage permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = createSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const org = await createOrganization(parsed.data, { principalId: auth.principalId })
          await recordEvent({
            principalId: auth.principalId,
            action: 'organization.created',
            targetType: 'organization',
            targetId: org.id,
            source: 'api',
            diff: { after: { name: org.name, domain: org.domain } },
          })
          return createdResponse(org)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
