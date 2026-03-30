/**
 * User attribute utilities
 *
 * Handles parsing, validation, and coercion of portal user attributes stored
 * in the user.metadata JSON column.
 */

import { db, userAttributeDefinitions } from '@/lib/server/db'
import type { UserAttributeType } from '@/lib/server/db'
import { coerceAttributeValue } from '@/lib/server/domains/user-attributes/coerce'
import { ValidationError } from '@/lib/shared/errors'

// ============================================
// Shared column selection helper
// ============================================

export const USER_COLUMNS = {
  id: true,
  name: true,
  email: true,
  image: true,
  emailVerified: true,
  metadata: true,
  createdAt: true,
} as const

// ============================================
// Internal constants
// ============================================

/** Internal metadata key for the customer-provided external user ID */
export const EXTERNAL_ID_KEY = '_externalUserId'

// ============================================
// Public utilities
// ============================================

/**
 * Safely parse user.metadata JSON string into an attributes object.
 * Returns {} on null or malformed input.
 * Strips internal system keys (prefixed with _) from the result.
 */
export function parseUserAttributes(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!key.startsWith('_')) result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

/** Extract external user ID from metadata JSON string */
export function extractExternalId(metadata: string | null): string | null {
  if (!metadata) return null
  try {
    const meta = JSON.parse(metadata) as Record<string, unknown>
    return typeof meta[EXTERNAL_ID_KEY] === 'string' ? meta[EXTERNAL_ID_KEY] : null
  } catch {
    return null
  }
}

/**
 * Validate and coerce incoming user attributes against configured attribute definitions.
 *
 * Attributes must be configured in Settings > User Attributes before they can be set.
 * Keys are matched by `definition.key` (not externalKey, which is for CDP integrations).
 *
 * Returns validated attributes and any errors encountered.
 */
export async function validateAndCoerceAttributes(attributes: Record<string, unknown>): Promise<{
  valid: Record<string, unknown>
  removals: string[]
  errors: Array<{ key: string; reason: string }>
}> {
  const errors: Array<{ key: string; reason: string }> = []
  const valid: Record<string, unknown> = {}
  const removals: string[] = []

  const attrDefs = await db.select().from(userAttributeDefinitions)
  const defByKey = new Map(attrDefs.map((d) => [d.key, d]))

  for (const [key, value] of Object.entries(attributes)) {
    const def = defByKey.get(key)
    if (!def) {
      errors.push({ key, reason: `No attribute definition found for key '${key}'` })
      continue
    }

    // null means "unset this attribute"
    if (value === null) {
      removals.push(key)
      continue
    }

    const coerced = coerceAttributeValue(value, def.type as UserAttributeType)
    if (coerced === undefined) {
      errors.push({
        key,
        reason: `Value '${String(value)}' cannot be coerced to type '${def.type}'`,
      })
      continue
    }

    valid[key] = coerced
  }

  return { valid, removals, errors }
}

/**
 * Merge validated attributes into existing metadata, applying removals.
 * Uses full JSON parse (not parseUserAttributes) to preserve internal _-prefixed keys.
 */
export function mergeMetadata(
  existing: string | null,
  valid: Record<string, unknown>,
  removals: string[]
): string {
  let current: Record<string, unknown> = {}
  if (existing) {
    try {
      current = JSON.parse(existing) as Record<string, unknown>
    } catch {
      // ignore malformed metadata
    }
  }
  const merged = { ...current, ...valid }
  for (const key of removals) {
    delete merged[key]
  }
  return JSON.stringify(merged)
}

/**
 * Validate attributes if provided, throwing on errors.
 * Returns validated attrs and removals (empty if no attributes given).
 */
export async function validateInputAttributes(
  attributes: Record<string, unknown> | undefined
): Promise<{ validAttrs: Record<string, unknown>; attrRemovals: string[] }> {
  if (!attributes || Object.keys(attributes).length === 0) {
    return { validAttrs: {}, attrRemovals: [] }
  }
  const result = await validateAndCoerceAttributes(attributes)
  if (result.errors.length > 0) {
    throw new ValidationError('VALIDATION_ERROR', 'One or more user attributes are invalid', {
      invalidAttributes: result.errors,
    })
  }
  return { validAttrs: result.valid, attrRemovals: result.removals }
}
