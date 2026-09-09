import { ensureTypeId, isValidTypeId, type IdPrefix } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'

/**
 * Validate a required TypeID parameter.
 * Throws ValidationError if the format is invalid.
 * Alias prefixes (e.g. `kb_article_` → `article_`) are rewritten to the
 * canonical prefix so callers always see the catalogue form.
 */
export function parseTypeId<T extends string>(
  value: string,
  prefix: IdPrefix,
  paramName = 'ID'
): T {
  if (!isValidTypeId(value, prefix)) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid ${paramName} format`)
  }
  return ensureTypeId(value, prefix) as T
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
  return ensureTypeId(value, prefix) as T
}

/**
 * Validate an array of TypeIDs.
 * Returns undefined when input is absent (not provided).
 * Returns [] when input is an explicit empty array.
 * Throws ValidationError if any entry has an invalid format.
 */
export function parseTypeIdArray<T extends string>(
  values: string[] | undefined,
  prefix: IdPrefix,
  paramName = 'IDs'
): T[] | undefined {
  if (values === undefined) return undefined
  return values.map((value) => {
    if (!isValidTypeId(value, prefix)) {
      throw new ValidationError('VALIDATION_ERROR', `Invalid ${paramName} format`)
    }
    return ensureTypeId(value, prefix) as T
  })
}
