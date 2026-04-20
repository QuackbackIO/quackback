import { isValidTypeId, type IdPrefix } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'

/**
 * Validate a required TypeID parameter.
 * Throws ValidationError if the format is invalid.
 * Returns the value cast to T so callers don't need a separate `as TypeId` cast.
 */
export function parseTypeId<T extends string>(
  value: string,
  prefix: IdPrefix,
  paramName = 'ID'
): T {
  if (!isValidTypeId(value, prefix)) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid ${paramName} format`)
  }
  return value as T
}

/**
 * Validate an optional TypeID.
 * Throws ValidationError if the value is present but has an invalid format.
 * Returns the typed value or undefined, so callers don't need a separate cast.
 */
export function parseOptionalTypeId<T extends string>(
  value: string | undefined | null,
  prefix: IdPrefix,
  paramName = 'ID'
): T | undefined {
  if (value === undefined || value === null) return undefined
  if (!isValidTypeId(value, prefix)) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid ${paramName} format`)
  }
  return value as T
}

/**
 * Validate an array of TypeIDs.
 * Throws ValidationError if any entry has an invalid format.
 * Returns the array cast to T[] so callers don't need a separate cast.
 */
export function parseTypeIdArray<T extends string>(
  values: string[] | undefined,
  prefix: IdPrefix,
  paramName = 'IDs'
): T[] {
  if (!values || values.length === 0) return []
  for (const value of values) {
    if (!isValidTypeId(value, prefix)) {
      throw new ValidationError('VALIDATION_ERROR', `Invalid ${paramName} format`)
    }
  }
  return values as T[]
}
