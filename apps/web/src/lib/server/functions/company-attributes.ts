/**
 * Server functions for company attribute definitions.
 *
 * Moved out of the companies function module so audience-taxonomy endpoints
 * live beside their user/conversation counterparts. Re-exported from
 * `./companies` so existing `functions/companies` importers keep working.
 */
import { createServerFn } from '@tanstack/react-start'
import type { CompanyAttributeId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  attributeDefinitionIdSchema,
  createAttributeDefinitionSchema,
  updateAttributeDefinitionSchema,
} from '@/lib/server/domains/attribute-definitions/attribute-definition.service'
import {
  listCompanyAttributes,
  createCompanyAttribute,
  updateCompanyAttribute,
  deleteCompanyAttribute,
} from '@/lib/server/domains/company-attributes'

/** List all company attribute definitions. */
export const listCompanyAttributesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
  return listCompanyAttributes()
})

/** Create a new company attribute definition. */
export const createCompanyAttributeFn = createServerFn({ method: 'POST' })
  .validator(createAttributeDefinitionSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    return createCompanyAttribute(data)
  })

/** Update an existing company attribute definition. */
export const updateCompanyAttributeFn = createServerFn({ method: 'POST' })
  .validator(updateAttributeDefinitionSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    const { id, ...input } = data
    return updateCompanyAttribute(id as CompanyAttributeId, input)
  })

/** Delete a company attribute definition. */
export const deleteCompanyAttributeFn = createServerFn({ method: 'POST' })
  .validator(attributeDefinitionIdSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    await deleteCompanyAttribute(data.id as CompanyAttributeId)
    return { deleted: true }
  })
