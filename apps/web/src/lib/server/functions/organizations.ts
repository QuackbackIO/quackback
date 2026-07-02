/**
 * Organizations server functions.
 *
 * Reads gated by ORG_VIEW; writes gated by ORG_MANAGE. Every write emits an
 * audit event so the admin trail captures CRM changes.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { OrganizationId } from '@quackback/ids'
import { requirePermission } from './auth-helpers'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import {
  createOrganization,
  updateOrganization,
  archiveOrganization,
  unarchiveOrganization,
  getOrganization,
  listOrganizations,
} from '@/lib/server/domains/organizations'
import { recordEvent } from '@/lib/server/domains/audit'

const organizationIdSchema = z.string().min(1) as z.ZodType<OrganizationId>

export const listOrganizationsFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      search: z.string().max(200).optional(),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    })
  )
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ORG_VIEW)
    return listOrganizations(data)
  })

export const getOrganizationFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ organizationId: organizationIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ORG_VIEW)
    return getOrganization(data.organizationId)
  })

const createOrgSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(255).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

export const createOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(createOrgSchema)
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ORG_MANAGE)
    const org = await createOrganization(data, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'organization.created',
      targetType: 'organization',
      targetId: org.id,
      diff: { after: { name: org.name, domain: org.domain } },
    })
    return org
  })

const updateOrgSchema = z.object({
  organizationId: organizationIdSchema,
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(255).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

export const updateOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(updateOrgSchema)
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ORG_MANAGE)
    const before = await getOrganization(data.organizationId)
    const { organizationId, ...patch } = data
    const org = await updateOrganization(organizationId, patch, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'organization.updated',
      targetType: 'organization',
      targetId: org.id,
      diff: {
        before: before
          ? { name: before.name, domain: before.domain, website: before.website }
          : undefined,
        after: { name: org.name, domain: org.domain, website: org.website },
      },
    })
    return org
  })

export const archiveOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ organizationId: organizationIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ORG_MANAGE)
    await archiveOrganization(data.organizationId, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'organization.archived',
      targetType: 'organization',
      targetId: data.organizationId,
    })
    return { ok: true as const }
  })

export const unarchiveOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ organizationId: organizationIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ORG_MANAGE)
    await unarchiveOrganization(data.organizationId, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'organization.unarchived',
      targetType: 'organization',
      targetId: data.organizationId,
    })
    return { ok: true as const }
  })
