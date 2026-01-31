/**
 * Core TypeID generation and conversion functions
 *
 * TypeID format: {prefix}_{base32_encoded_uuidv7}
 * Example: post_01h455vb4pex5vsknk084sn02q
 *
 * The underlying UUID is UUIDv7 which provides:
 * - Time-ordered IDs (better database index performance)
 * - 49% faster inserts compared to UUIDv4
 * - 26% smaller indexes
 * - No index fragmentation
 */

import { typeid, TypeID } from 'typeid-js'
import { ID_PREFIXES, type IdPrefix, type EntityType } from './prefixes'
import type { TypeId, EntityIdMap } from './types'

/**
 * UUID format regex for validation
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * TypeID format regex (prefix_base32suffix)
 */
const TYPEID_REGEX = /^[a-z][a-z_]*_[0-7][0-9a-hjkmnp-tv-z]{25}$/

// ============================================
// Generation Functions
// ============================================

/**
 * Generate a new TypeID with UUIDv7 for the given prefix
 *
 * @param prefix - The entity type prefix (e.g., 'post', 'board')
 * @returns A new TypeID string with the prefix and a UUIDv7-based suffix
 *
 * @example
 * const id = generateId('post')
 * // => 'post_01h455vb4pex5vsknk084sn02q'
 */
export function generateId<P extends IdPrefix>(prefix: P): TypeId<P> {
  // typeid() returns `${P}_${string}` which matches our TypeId<P>
  return typeid(prefix).toString() as TypeId<P>
}

/**
 * Generate a new TypeID for a given entity type
 *
 * @param entity - The entity type key (e.g., 'post', 'board')
 * @returns A new TypeID string
 *
 * @example
 * const id = createId('post')
 * // => 'post_01h455vb4pex5vsknk084sn02q'
 */
export function createId<E extends EntityType>(entity: E): EntityIdMap[E] {
  const prefix = ID_PREFIXES[entity]
  return generateId(prefix) as EntityIdMap[E]
}

// ============================================
// Conversion Functions
// ============================================

/**
 * Convert a TypeID string to its underlying UUID
 *
 * @param typeIdString - A TypeID string (e.g., 'post_01h455vb4pex5vsknk084sn02q')
 * @returns The underlying UUID string
 * @throws Error if the TypeID format is invalid
 *
 * @example
 * const uuid = toUuid('post_01h455vb4pex5vsknk084sn02q')
 * // => '01893d8c-7e80-7000-8000-000000000000'
 */
export function toUuid(typeIdString: string): string {
  return TypeID.fromString(typeIdString).toUUID()
}

/**
 * Convert a UUID to a TypeID string with the given prefix
 *
 * @param prefix - The entity type prefix
 * @param uuid - A UUID string (any version)
 * @returns A TypeID string combining the prefix and encoded UUID
 * @throws Error if the UUID format is invalid
 *
 * @example
 * const typeId = fromUuid('post', '01893d8c-7e80-7000-8000-000000000000')
 * // => 'post_01h455vb4pex5vsknk084sn02q'
 */
export function fromUuid<P extends IdPrefix>(prefix: P, uuid: string): TypeId<P> {
  if (!UUID_REGEX.test(uuid)) {
    throw new Error(`Invalid UUID format: ${uuid}`)
  }
  return TypeID.fromUUID(prefix, uuid).toString() as TypeId<P>
}

/**
 * Parse a TypeID string into its components
 *
 * @param typeIdString - A TypeID string
 * @returns Object with prefix and uuid properties
 * @throws Error if the TypeID format is invalid
 *
 * @example
 * const { prefix, uuid } = parseTypeId('post_01h455vb4pex5vsknk084sn02q')
 * // => { prefix: 'post', uuid: '01893d8c-7e80-7000-8000-000000000000' }
 */
export function parseTypeId(typeIdString: string): { prefix: string; uuid: string } {
  const tid = TypeID.fromString(typeIdString)
  return {
    prefix: tid.getType(),
    uuid: tid.toUUID(),
  }
}

/**
 * Get just the prefix from a TypeID string
 *
 * @param typeIdString - A TypeID string
 * @returns The prefix portion
 * @throws Error if the TypeID format is invalid
 */
export function getTypeIdPrefix(typeIdString: string): string {
  return TypeID.fromString(typeIdString).getType()
}

// ============================================
// Validation Functions
// ============================================

/**
 * Check if a string is a valid TypeID, optionally checking prefix
 *
 * @param value - The string to validate
 * @param expectedPrefix - Optional prefix to validate against
 * @returns true if the string is a valid TypeID (with matching prefix if specified)
 *
 * @example
 * isValidTypeId('post_01h455vb4pex5vsknk084sn02q') // true
 * isValidTypeId('post_01h455vb4pex5vsknk084sn02q', 'post') // true
 * isValidTypeId('post_01h455vb4pex5vsknk084sn02q', 'board') // false
 * isValidTypeId('invalid') // false
 */
export function isValidTypeId(value: string, expectedPrefix?: IdPrefix): boolean {
  try {
    const tid = TypeID.fromString(value)
    if (expectedPrefix && tid.getType() !== expectedPrefix) {
      return false
    }
    // Also verify the suffix is valid base32 by attempting UUID conversion
    tid.toUUID()
    return true
  } catch {
    return false
  }
}

/**
 * Type guard for checking if a string is a valid TypeID with specific prefix
 */
export function isTypeId<P extends IdPrefix>(value: string, prefix: P): value is TypeId<P> {
  return isValidTypeId(value, prefix)
}

/**
 * Check if a string is a valid UUID (any version)
 *
 * @param value - The string to check
 * @returns true if the string is a valid UUID format
 */
export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value)
}

/**
 * Check if a string looks like a TypeID (has underscore separator)
 *
 * @param value - The string to check
 * @returns true if the string appears to be a TypeID format
 */
export function isTypeIdFormat(value: string): boolean {
  return TYPEID_REGEX.test(value)
}

// ============================================
// Batch Operations
// ============================================

/**
 * Convert multiple UUIDs to TypeIDs with the same prefix
 *
 * @param prefix - The entity type prefix
 * @param uuids - Array of UUID strings
 * @returns Array of TypeID strings
 *
 * @example
 * const typeIds = batchFromUuid('post', [uuid1, uuid2, uuid3])
 */
export function batchFromUuid<P extends IdPrefix>(prefix: P, uuids: string[]): TypeId<P>[] {
  return uuids.map((uuid) => fromUuid(prefix, uuid))
}

/**
 * Convert multiple TypeIDs to UUIDs
 *
 * @param typeIds - Array of TypeID strings
 * @returns Array of UUID strings
 *
 * @example
 * const uuids = batchToUuid([typeId1, typeId2, typeId3])
 */
export function batchToUuid(typeIds: string[]): string[] {
  return typeIds.map(toUuid)
}

// ============================================
// Flexible ID Handling (for backward compatibility)
// ============================================

/**
 * Normalize an ID to UUID format
 * Accepts either TypeID or raw UUID, returns UUID
 *
 * @param id - Either a TypeID string or a raw UUID
 * @param expectedPrefix - Optional prefix to validate (only checked for TypeIDs)
 * @returns The UUID string
 * @throws Error if the ID format is invalid
 *
 * @example
 * normalizeToUuid('post_01h455vb4pex5vsknk084sn02q') // => UUID string
 * normalizeToUuid('01893d8c-7e80-7000-8000-000000000000') // => same UUID string
 */
export function normalizeToUuid(id: string, expectedPrefix?: IdPrefix): string {
  // If it's already a UUID, return as-is
  if (isUuid(id)) {
    return id
  }

  // Parse as TypeID
  const parsed = parseTypeId(id)

  // Validate prefix if specified
  if (expectedPrefix && parsed.prefix !== expectedPrefix) {
    throw new Error(`Expected ${expectedPrefix} ID, got ${parsed.prefix}`)
  }

  return parsed.uuid
}

/**
 * Ensure an ID is in TypeID format
 * Accepts either TypeID or raw UUID, returns TypeID
 *
 * @param id - Either a TypeID string or a raw UUID
 * @param prefix - The prefix to use (required if input might be UUID)
 * @returns The TypeID string
 *
 * @example
 * ensureTypeId('01893d8c-7e80-7000-8000-000000000000', 'post')
 * // => 'post_01h455vb4pex5vsknk084sn02q'
 */
export function ensureTypeId<P extends IdPrefix>(id: string, prefix: P): TypeId<P> {
  if (isUuid(id)) {
    return fromUuid(prefix, id)
  }

  // Validate it's a TypeID with correct prefix
  if (!isValidTypeId(id, prefix)) {
    throw new Error(`Invalid ${prefix} ID: ${id}`)
  }

  return id as TypeId<P>
}
