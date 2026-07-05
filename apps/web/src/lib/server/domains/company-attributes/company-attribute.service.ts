/**
 * Company attribute definitions (§K2) — a wholesale clone of the
 * user-attributes domain over company_attribute_definitions. Values live in
 * the shipped companies.custom_attributes jsonb; these rows only define the
 * typed keys the segment builder and profile editors surface.
 */
import { db, eq, asc, companyAttributeDefinitions } from '@/lib/server/db'
import type { CompanyAttributeId } from '@quackback/ids'
import { createId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError, InternalError } from '@/lib/shared/errors'
import { isUniqueViolation } from '@/lib/server/utils'
import type {
  CompanyAttribute,
  CreateCompanyAttributeInput,
  UpdateCompanyAttributeInput,
} from './company-attribute.types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'company-attributes' })

function rowToCompanyAttribute(
  row: typeof companyAttributeDefinitions.$inferSelect
): CompanyAttribute {
  return {
    id: row.id as CompanyAttributeId,
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    currencyCode: row.currencyCode,
    externalKey: row.externalKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function listCompanyAttributes(): Promise<CompanyAttribute[]> {
  try {
    const rows = await db
      .select()
      .from(companyAttributeDefinitions)
      .orderBy(asc(companyAttributeDefinitions.label))
    return rows.map(rowToCompanyAttribute)
  } catch (error) {
    log.error({ err: error }, 'failed to list company attributes')
    throw new InternalError('DATABASE_ERROR', 'Failed to list company attributes', error)
  }
}

export async function createCompanyAttribute(
  input: CreateCompanyAttributeInput
): Promise<CompanyAttribute> {
  try {
    if (!input.key?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Attribute key is required')
    }
    if (!input.label?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Attribute label is required')
    }
    if (input.type === 'currency' && !input.currencyCode) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'Currency code is required for currency attributes'
      )
    }

    const id = createId('company_attr') as CompanyAttributeId

    const [row] = await db
      .insert(companyAttributeDefinitions)
      .values({
        id,
        key: input.key.trim().toLowerCase().replace(/\s+/g, '_'),
        label: input.label.trim(),
        description: input.description?.trim() || null,
        type: input.type,
        currencyCode: input.type === 'currency' ? (input.currencyCode ?? null) : null,
        externalKey: input.externalKey?.trim() || null,
      })
      .returning()

    return rowToCompanyAttribute(row)
  } catch (error) {
    if (error instanceof ValidationError) throw error
    if (isUniqueViolation(error)) {
      throw new ConflictError('DUPLICATE_KEY', `An attribute with that key already exists`)
    }
    log.error({ err: error }, 'failed to create company attribute')
    throw new InternalError('DATABASE_ERROR', 'Failed to create company attribute', error)
  }
}

export async function updateCompanyAttribute(
  id: CompanyAttributeId,
  input: UpdateCompanyAttributeInput
): Promise<CompanyAttribute> {
  try {
    const existing = await db.query.companyAttributeDefinitions.findFirst({
      where: eq(companyAttributeDefinitions.id, id),
    })
    if (!existing) {
      throw new NotFoundError('NOT_FOUND', `Company attribute ${id} not found`)
    }

    const updates: Partial<typeof companyAttributeDefinitions.$inferInsert> = {}
    if (input.label !== undefined) updates.label = input.label.trim()
    if (input.description !== undefined) updates.description = input.description
    if (input.type !== undefined) {
      updates.type = input.type
      // Clear currency code when switching away from currency type
      if (input.type !== 'currency') {
        updates.currencyCode = null
      }
    }
    if (input.currencyCode !== undefined) updates.currencyCode = input.currencyCode
    if (input.externalKey !== undefined) updates.externalKey = input.externalKey?.trim() || null

    if (Object.keys(updates).length === 0) return rowToCompanyAttribute(existing)

    const [row] = await db
      .update(companyAttributeDefinitions)
      .set(updates)
      .where(eq(companyAttributeDefinitions.id, id))
      .returning()

    return rowToCompanyAttribute(row)
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error
    log.error({ err: error }, 'failed to update company attribute')
    throw new InternalError('DATABASE_ERROR', 'Failed to update company attribute', error)
  }
}

export async function deleteCompanyAttribute(id: CompanyAttributeId): Promise<void> {
  try {
    const existing = await db.query.companyAttributeDefinitions.findFirst({
      where: eq(companyAttributeDefinitions.id, id),
    })
    if (!existing) {
      throw new NotFoundError('NOT_FOUND', `Company attribute ${id} not found`)
    }
    await db.delete(companyAttributeDefinitions).where(eq(companyAttributeDefinitions.id, id))
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    log.error({ err: error }, 'failed to delete company attribute')
    throw new InternalError('DATABASE_ERROR', 'Failed to delete company attribute', error)
  }
}
