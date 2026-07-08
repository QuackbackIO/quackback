import { db, eq, asc, userAttributeDefinitions } from '@/lib/server/db'
import type { UserAttributeId } from '@quackback/ids'
import { createId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError, InternalError } from '@/lib/shared/errors'
import type {
  UserAttribute,
  CreateUserAttributeInput,
  UpdateUserAttributeInput,
} from './user-attribute.types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'user-attributes' })

/**
 * Best-effort webhook dispatch for user-attribute definition lifecycle events.
 * Lazy import + `service` actor + try/catch so a dispatch failure never aborts
 * the mutation. Mirrors the config-plane fire helpers.
 */
async function fireUserAttributeEvent(
  kind: 'created' | 'updated' | 'deleted',
  attribute: UserAttribute,
  changedFields?: string[]
): Promise<void> {
  try {
    const {
      dispatchUserAttributeCreated,
      dispatchUserAttributeUpdated,
      dispatchUserAttributeDeleted,
    } = await import('@/lib/server/events/dispatch')
    const actor = { type: 'service' as const, displayName: 'user-attribute-system' }
    const ref = {
      id: attribute.id,
      key: attribute.key,
      label: attribute.label,
      type: attribute.type,
      currencyCode: attribute.currencyCode ?? null,
      externalKey: attribute.externalKey ?? null,
      createdAt: attribute.createdAt ? attribute.createdAt.toISOString() : null,
      updatedAt: attribute.updatedAt ? attribute.updatedAt.toISOString() : null,
    }
    if (kind === 'created') await dispatchUserAttributeCreated(actor, ref)
    else if (kind === 'updated') await dispatchUserAttributeUpdated(actor, ref, changedFields ?? [])
    else await dispatchUserAttributeDeleted(actor, ref)
  } catch (err) {
    log.error({ err }, `failed to dispatch user_attribute.${kind} event`)
  }
}

function rowToUserAttribute(row: typeof userAttributeDefinitions.$inferSelect): UserAttribute {
  return {
    id: row.id as UserAttributeId,
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

export async function listUserAttributes(): Promise<UserAttribute[]> {
  try {
    const rows = await db
      .select()
      .from(userAttributeDefinitions)
      .orderBy(asc(userAttributeDefinitions.label))
    return rows.map(rowToUserAttribute)
  } catch (error) {
    log.error({ err: error }, 'failed to list user attributes')
    throw new InternalError('DATABASE_ERROR', 'Failed to list user attributes', error)
  }
}

export async function createUserAttribute(input: CreateUserAttributeInput): Promise<UserAttribute> {
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

    const id = createId('user_attr') as UserAttributeId

    const [row] = await db
      .insert(userAttributeDefinitions)
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

    const attribute = rowToUserAttribute(row)
    void fireUserAttributeEvent('created', attribute)
    return attribute
  } catch (error) {
    if (error instanceof ValidationError) throw error
    if ((error as { code?: string }).code === '23505') {
      throw new ConflictError('DUPLICATE_KEY', `An attribute with that key already exists`)
    }
    log.error({ err: error }, 'failed to create user attribute')
    throw new InternalError('DATABASE_ERROR', 'Failed to create user attribute', error)
  }
}

export async function updateUserAttribute(
  id: UserAttributeId,
  input: UpdateUserAttributeInput
): Promise<UserAttribute> {
  try {
    const existing = await db.query.userAttributeDefinitions.findFirst({
      where: eq(userAttributeDefinitions.id, id),
    })
    if (!existing) {
      throw new NotFoundError('NOT_FOUND', `User attribute ${id} not found`)
    }

    const updates: Partial<typeof userAttributeDefinitions.$inferInsert> = {}
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

    if (Object.keys(updates).length === 0) return rowToUserAttribute(existing)

    const [row] = await db
      .update(userAttributeDefinitions)
      .set(updates)
      .where(eq(userAttributeDefinitions.id, id))
      .returning()

    const attribute = rowToUserAttribute(row)
    void fireUserAttributeEvent('updated', attribute, Object.keys(updates))
    return attribute
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error
    log.error({ err: error }, 'failed to update user attribute')
    throw new InternalError('DATABASE_ERROR', 'Failed to update user attribute', error)
  }
}

export async function deleteUserAttribute(id: UserAttributeId): Promise<void> {
  try {
    const existing = await db.query.userAttributeDefinitions.findFirst({
      where: eq(userAttributeDefinitions.id, id),
    })
    if (!existing) {
      throw new NotFoundError('NOT_FOUND', `User attribute ${id} not found`)
    }
    await db.delete(userAttributeDefinitions).where(eq(userAttributeDefinitions.id, id))
    void fireUserAttributeEvent('deleted', rowToUserAttribute(existing))
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    log.error({ err: error }, 'failed to delete user attribute')
    throw new InternalError('DATABASE_ERROR', 'Failed to delete user attribute', error)
  }
}
