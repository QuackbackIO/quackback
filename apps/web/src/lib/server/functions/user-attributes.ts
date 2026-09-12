/**
 * Server functions for user attribute definitions.
 *
 * Moved out of the admin function module so audience-taxonomy endpoints live
 * beside their company/conversation counterparts. Re-exported from
 * `./admin` so existing `functions/admin` importers keep working.
 */
import { createServerFn } from '@tanstack/react-start'
import type { UserAttributeId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  attributeDefinitionIdSchema,
  createAttributeDefinitionSchema,
  updateAttributeDefinitionSchema,
} from '@/lib/server/domains/attribute-definitions/attribute-definition.service'
import {
  listUserAttributes,
  createUserAttribute,
  updateUserAttribute,
  deleteUserAttribute,
} from '@/lib/server/domains/user-attributes/user-attribute.service'

/**
 * List all user attribute definitions.
 */
export const listUserAttributesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.USER_ATTRIBUTE_VIEW })
  return listUserAttributes()
})

/**
 * Create a new user attribute definition.
 */
export const createUserAttributeFn = createServerFn({ method: 'POST' })
  .validator(createAttributeDefinitionSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.USER_ATTRIBUTE_MANAGE })
    return createUserAttribute({
      key: data.key,
      label: data.label,
      description: data.description,
      type: data.type,
      currencyCode: data.currencyCode,
      externalKey: data.externalKey,
    })
  })

/**
 * Update an existing user attribute definition.
 */
export const updateUserAttributeFn = createServerFn({ method: 'POST' })
  .validator(updateAttributeDefinitionSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.USER_ATTRIBUTE_MANAGE })
    return updateUserAttribute(data.id as UserAttributeId, {
      label: data.label,
      description: data.description,
      type: data.type,
      currencyCode: data.currencyCode,
      externalKey: data.externalKey,
    })
  })

/**
 * Delete a user attribute definition.
 */
export const deleteUserAttributeFn = createServerFn({ method: 'POST' })
  .validator(attributeDefinitionIdSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.USER_ATTRIBUTE_MANAGE })
    await deleteUserAttribute(data.id as UserAttributeId)
    return { deleted: true }
  })
