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
import { createContact, searchContacts } from '@/lib/server/domains/organizations'
import { recordEvent } from '@/lib/server/domains/audit'
import type { OrganizationId } from '@quackback/ids'

const createSchema = z.object({
  name: z.string().min(1).max(200).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  organizationId: z.string().min(1).nullable().optional(),
  avatarUrl: z.string().max(2048).nullable().optional(),
})

export const Route = createFileRoute('/api/v1/contacts/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ORG_VIEW)
          if (!hasPermission(set, PERMISSIONS.ORG_VIEW)) {
            return forbiddenResponse('org.view permission required')
          }
          const url = new URL(request.url)
          const query = url.searchParams.get('q') ?? undefined
          const email = url.searchParams.get('email') ?? undefined
          const organizationId = (url.searchParams.get('organizationId') ?? undefined) as
            | OrganizationId
            | undefined
          const includeArchived = url.searchParams.get('includeArchived') === 'true'
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25', 10), 100)
          const offset = decodeCursor(cursor)
          const items = await searchContacts({
            query,
            email,
            organizationId,
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
          const contact = await createContact(
            {
              ...parsed.data,
              organizationId: parsed.data.organizationId as OrganizationId | null | undefined,
            },
            { principalId: auth.principalId }
          )
          await recordEvent({
            principalId: auth.principalId,
            action: 'contact.created',
            targetType: 'contact',
            targetId: contact.id,
            source: 'api',
            diff: { after: { name: contact.name, email: contact.email } },
          })
          return createdResponse(contact)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
