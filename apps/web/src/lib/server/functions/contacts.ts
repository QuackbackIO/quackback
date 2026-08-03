/**
 * Contacts server functions.
 *
 * Reads gated by ORG_VIEW; writes gated by ORG_MANAGE. Linking/unlinking
 * emits audit events so the admin trail captures contact↔user mappings.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ContactId, OrganizationId, UserId } from '@quackback/ids'
import { requirePermission } from './auth-helpers'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import {
  createContact,
  updateContact,
  archiveContact,
  getContact,
  listContactsForOrganization,
  searchContacts,
  linkContactToUser,
  unlinkContactFromUser,
  listLinksForContact,
} from '@/lib/server/domains/organizations'
import { recordEvent } from '@/lib/server/domains/audit'

const contactIdSchema = z.string().min(1) as z.ZodType<ContactId>
const organizationIdSchema = z.string().min(1) as z.ZodType<OrganizationId>
const userIdSchema = z.string().min(1) as z.ZodType<UserId>

export const searchContactsFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      query: z.string().max(200).optional(),
      email: z.string().max(320).optional(),
      organizationId: organizationIdSchema.optional(),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    })
  )
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ORG_VIEW)
    return searchContacts(data)
  })

export const listContactsForOrganizationFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      organizationId: organizationIdSchema,
      includeArchived: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    })
  )
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ORG_VIEW)
    const { organizationId, ...rest } = data
    return listContactsForOrganization(organizationId, rest)
  })

export const getContactFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ contactId: contactIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ORG_VIEW)
    return getContact(data.contactId)
  })

const createContactSchema = z.object({
  name: z.string().min(1).max(200).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  organizationId: organizationIdSchema.nullable().optional(),
  avatarUrl: z.string().max(2048).nullable().optional(),
})

export const createContactFn = createServerFn({ method: 'POST' })
  .inputValidator(createContactSchema)
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ORG_MANAGE)
    const contact = await createContact(data, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'contact.created',
      targetType: 'contact',
      targetId: contact.id,
      diff: {
        after: { name: contact.name, email: contact.email, organizationId: contact.organizationId },
      },
    })
    return contact
  })

const updateContactSchema = createContactSchema.extend({ contactId: contactIdSchema })

export const updateContactFn = createServerFn({ method: 'POST' })
  .inputValidator(updateContactSchema)
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ORG_MANAGE)
    const before = await getContact(data.contactId)
    const { contactId, ...patch } = data
    const contact = await updateContact(contactId, patch, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'contact.updated',
      targetType: 'contact',
      targetId: contact.id,
      diff: {
        before: before
          ? { name: before.name, email: before.email, organizationId: before.organizationId }
          : undefined,
        after: { name: contact.name, email: contact.email, organizationId: contact.organizationId },
      },
    })
    return contact
  })

export const archiveContactFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ contactId: contactIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ORG_MANAGE)
    await archiveContact(data.contactId, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'contact.archived',
      targetType: 'contact',
      targetId: data.contactId,
    })
    return { ok: true as const }
  })

export const linkContactToUserFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ contactId: contactIdSchema, userId: userIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ORG_MANAGE)
    const link = await linkContactToUser(
      {
        contactId: data.contactId,
        userId: data.userId,
        linkedByPrincipalId: ctx.principal.id,
      },
      { principalId: ctx.principal.id, userId: ctx.user.id }
    )
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'contact.linked_user',
      targetType: 'contact',
      targetId: data.contactId,
      diff: { context: { userId: data.userId } },
    })
    return link
  })

export const unlinkContactFromUserFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ contactId: contactIdSchema, userId: userIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ORG_MANAGE)
    await unlinkContactFromUser(data.contactId, data.userId, {
      principalId: ctx.principal.id,
      userId: ctx.user.id,
    })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'contact.unlinked_user',
      targetType: 'contact',
      targetId: data.contactId,
      diff: { context: { userId: data.userId } },
    })
    return { ok: true as const }
  })

export const listLinksForContactFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ contactId: contactIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ORG_VIEW)
    return listLinksForContact(data.contactId)
  })
