import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  notFoundResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import {
  archiveOrganization,
  getOrganization,
  updateOrganization,
} from '@/lib/server/domains/organizations'
import { recordEvent } from '@/lib/server/domains/audit'
import type { OrganizationId } from '@quackback/ids'

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(255).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

export const Route = createFileRoute('/api/v1/organizations/$organizationId')({
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
          const org = await getOrganization(id)
          if (!org) return notFoundResponse('Organization not found')
          return successResponse(org)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ORG_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ORG_MANAGE)) {
            return forbiddenResponse('org.manage permission required')
          }
          const id = parseTypeId<OrganizationId>(params.organizationId, 'org', 'organization ID')
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const before = await getOrganization(id)
          const org = await updateOrganization(id, parsed.data, { principalId: auth.principalId })
          await recordEvent({
            principalId: auth.principalId,
            action: 'organization.updated',
            targetType: 'organization',
            targetId: org.id,
            source: 'api',
            diff: {
              before: before ? { name: before.name, domain: before.domain } : undefined,
              after: { name: org.name, domain: org.domain },
            },
          })
          return successResponse(org)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      /** DELETE = archive (soft) */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ORG_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ORG_MANAGE)) {
            return forbiddenResponse('org.manage permission required')
          }
          const id = parseTypeId<OrganizationId>(params.organizationId, 'org', 'organization ID')
          await archiveOrganization(id, { principalId: auth.principalId })
          await recordEvent({
            principalId: auth.principalId,
            action: 'organization.archived',
            targetType: 'organization',
            targetId: id,
            source: 'api',
          })
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
