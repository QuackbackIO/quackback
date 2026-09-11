/**
 * Generic attribute-definition service (§K2).
 *
 * User attributes (`user_attribute_definitions`) and company attributes
 * (`company_attribute_definitions`) are structurally identical tables with
 * identical lifecycles (list/create/update/hard-delete) and identical
 * validation. The company domain header documents itself as a wholesale
 * clone of the user domain — this module is the single implementation both
 * thin wrappers delegate to, so validation, key normalization, and error
 * mapping can no longer drift apart.
 *
 * Typing note: the two tables differ only in their id column's TypeID prefix
 * (`user_attr_*` vs `company_attr_*`), which is a compile-time-only
 * distinction — at runtime the columns are identical text keys. The factory
 * therefore operates on one concrete table type with a documented cast at
 * the boundary rather than a Drizzle generic (whose overloads collapse a
 * table union to `never`).
 *
 * Conversation attributes stay separate: different table shape (options,
 * AI-detect), archive/restore lifecycle, and no hard delete.
 */
import { z } from 'zod'
import {
  db,
  eq,
  asc,
  userAttributeDefinitions,
  companyAttributeDefinitions,
  type UserAttributeType,
  type CurrencyCode,
} from '@/lib/server/db'
import { createId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError, InternalError } from '@/lib/shared/errors'
import { isUniqueViolation } from '@/lib/server/utils'
import { logger } from '@/lib/server/logger'

/** Attribute value type + ISO-4217 selectors shared by the user/company fn schemas. */
export const AttributeTypeSchema = z.enum(['string', 'number', 'boolean', 'date', 'currency'])

export const CurrencyCodeSchema = z.enum([
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'CNY',
  'INR',
  'BRL',
])

/** Normalize a machine key: trimmed, lowercased, whitespace to underscores. */
export function normalizeAttributeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_')
}

export interface AttributeDefinitionInput {
  key: string
  label: string
  description?: string | null
  type: UserAttributeType
  currencyCode?: CurrencyCode | null
  externalKey?: string | null
}

export interface AttributeDefinitionUpdate {
  label?: string
  description?: string | null
  type?: UserAttributeType
  currencyCode?: CurrencyCode | null
  externalKey?: string | null
}

export interface AttributeDefinition {
  id: string
  key: string
  label: string
  description: string | null
  type: UserAttributeType
  currencyCode: CurrencyCode | null
  externalKey: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AttributeDefinitionServiceConfig {
  table: typeof userAttributeDefinitions | typeof companyAttributeDefinitions
  idPrefix: 'user_attr' | 'company_attr'
  /** 'User attribute' / 'Company attribute' — preserved verbatim in error messages. */
  singular: string
  /** 'user attributes' / 'company attributes' — preserved verbatim in log lines. */
  plural: string
  logComponent: string
}

function validateCreate(input: AttributeDefinitionInput): void {
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
}

export function createAttributeDefinitionService(config: AttributeDefinitionServiceConfig) {
  const { idPrefix, singular, plural, logComponent } = config
  // Structurally identical tables; only the id TypeID prefix differs.
  const table = config.table as typeof userAttributeDefinitions
  const log = logger.child({ component: logComponent })

  type Row = typeof table.$inferSelect

  function toDefinition(row: Row): AttributeDefinition {
    return {
      id: row.id,
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

  async function findById(id: string): Promise<Row | undefined> {
    const rows = await db
      .select()
      .from(table)
      .where(eq(table.id, id as Row['id']))
      .limit(1)
    return rows[0]
  }

  return {
    async list(): Promise<AttributeDefinition[]> {
      try {
        const rows = await db.select().from(table).orderBy(asc(table.label))
        return rows.map(toDefinition)
      } catch (error) {
        log.error({ err: error }, `failed to list ${plural}`)
        throw new InternalError('DATABASE_ERROR', `Failed to list ${plural}`, error)
      }
    },

    async create(input: AttributeDefinitionInput): Promise<AttributeDefinition> {
      try {
        validateCreate(input)

        const [row] = await db
          .insert(table)
          .values({
            id: createId(idPrefix) as Row['id'],
            key: normalizeAttributeKey(input.key),
            label: input.label.trim(),
            description: input.description?.trim() || null,
            type: input.type,
            currencyCode: input.type === 'currency' ? (input.currencyCode ?? null) : null,
            externalKey: input.externalKey?.trim() || null,
          })
          .returning()

        return toDefinition(row)
      } catch (error) {
        if (error instanceof ValidationError) throw error
        if (isUniqueViolation(error)) {
          throw new ConflictError('DUPLICATE_KEY', 'An attribute with that key already exists')
        }
        log.error({ err: error }, `failed to create ${plural}`)
        throw new InternalError('DATABASE_ERROR', `Failed to create ${plural}`, error)
      }
    },

    async update(id: string, input: AttributeDefinitionUpdate): Promise<AttributeDefinition> {
      try {
        const existing = await findById(id)
        if (!existing) {
          throw new NotFoundError('NOT_FOUND', `${singular} ${id} not found`)
        }

        const updates: Partial<typeof table.$inferInsert> = {}
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

        if (Object.keys(updates).length === 0) return toDefinition(existing)

        const [row] = await db
          .update(table)
          .set(updates)
          .where(eq(table.id, id as Row['id']))
          .returning()

        return toDefinition(row)
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof ValidationError) throw error
        log.error({ err: error }, `failed to update ${plural}`)
        throw new InternalError('DATABASE_ERROR', `Failed to update ${plural}`, error)
      }
    },

    async remove(id: string): Promise<void> {
      try {
        const existing = await findById(id)
        if (!existing) {
          throw new NotFoundError('NOT_FOUND', `${singular} ${id} not found`)
        }
        await db.delete(table).where(eq(table.id, id as Row['id']))
      } catch (error) {
        if (error instanceof NotFoundError) throw error
        log.error({ err: error }, `failed to delete ${plural}`)
        throw new InternalError('DATABASE_ERROR', `Failed to delete ${plural}`, error)
      }
    },
  }
}
