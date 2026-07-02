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
import { archiveContact, getContact, updateContact } from '@/lib/server/domains/organizations'
import { recordEvent } from '@/lib/server/domains/audit'
import type { ContactId, OrganizationId } from '@quackback/ids'

const patchSchema = z.object({
  name: z.string().min(1).max(200).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  organizationId: z.string().min(1).nullable().optional(),
  avatarUrl: z.string().max(2048).nullable().optional(),
})

export const Route = createFileRoute('/api/v1/contacts/$contactId')({
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
          const id = parseTypeId<ContactId>(params.contactId, 'contact', 'contact ID')
          const contact = await getContact(id)
          if (!contact) return notFoundResponse('Contact not found')
          return successResponse(contact)
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
          const id = parseTypeId<ContactId>(params.contactId, 'contact', 'contact ID')
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const before = await getContact(id)
          const contact = await updateContact(
            id,
            {
              ...parsed.data,
              organizationId: parsed.data.organizationId as OrganizationId | null | undefined,
            },
            { principalId: auth.principalId }
          )
          await recordEvent({
            principalId: auth.principalId,
            action: 'contact.updated',
            targetType: 'contact',
            targetId: contact.id,
            source: 'api',
            diff: {
              before: before ? { name: before.name, email: before.email } : undefined,
              after: { name: contact.name, email: contact.email },
            },
          })
          return successResponse(contact)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ORG_MANAGE)
          if (!hasPermission(set, PERMISSIONS.ORG_MANAGE)) {
            return forbiddenResponse('org.manage permission required')
          }
          const id = parseTypeId<ContactId>(params.contactId, 'contact', 'contact ID')
          await archiveContact(id, { principalId: auth.principalId })
          await recordEvent({
            principalId: auth.principalId,
            action: 'contact.archived',
            targetType: 'contact',
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
