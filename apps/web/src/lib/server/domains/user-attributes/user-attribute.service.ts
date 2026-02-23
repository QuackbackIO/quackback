import { db, eq, asc, userAttributeDefinitions } from '@/lib/server/db'
import type { UserAttributeId } from '@quackback/ids'
import { createId } from '@quackback/ids'
import { NotFoundError, ValidationError, InternalError } from '@/lib/shared/errors'
import type {
  UserAttribute,
  CreateUserAttributeInput,
  UpdateUserAttributeInput,
} from './user-attribute.types'

function rowToUserAttribute(row: typeof userAttributeDefinitions.$inferSelect): UserAttribute {
  return {
    id: row.id as UserAttributeId,
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    currencyCode: row.currencyCode,
    externalKey: row.externalKey ?? null,
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
    console.error('Error listing user attributes:', error)
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

    return rowToUserAttribute(row)
  } catch (error) {
    if (error instanceof ValidationError) throw error
    // Unique key violation
    if ((error as { code?: string }).code === '23505') {
      throw new ValidationError('DUPLICATE_KEY', `An attribute with that key already exists`)
    }
    console.error('Error creating user attribute:', error)
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

    return rowToUserAttribute(row)
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error
    console.error('Error updating user attribute:', error)
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
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    console.error('Error deleting user attribute:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to delete user attribute', error)
  }
}
