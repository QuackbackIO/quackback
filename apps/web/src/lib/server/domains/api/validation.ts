/**
 * API Validation Helpers
 *
 * Utilities for validating API request parameters.
 */

import { isValidTypeId, type IdPrefix } from '@quackback/ids'
import { badRequestResponse } from './responses'

/**
 * Validate a TypeID path parameter.
 * Returns a Response if invalid, undefined if valid.
 */
export function validateTypeId(
  value: string,
  prefix: IdPrefix,
  paramName = 'ID'
): Response | undefined {
  if (!isValidTypeId(value, prefix)) {
    return badRequestResponse(`Invalid ${paramName} format`)
  }
  return undefined
}

/**
 * Validate an optional TypeID in a request body.
 * Returns a Response if invalid, undefined if valid or not provided.
 */
export function validateOptionalTypeId(
  value: string | undefined | null,
  prefix: IdPrefix,
  paramName = 'ID'
): Response | undefined {
  if (value === undefined || value === null) return undefined
  if (!isValidTypeId(value, prefix)) {
    return badRequestResponse(`Invalid ${paramName} format`)
  }
  return undefined
}

/**
 * Validate an array of TypeIDs in a request body.
 * Returns a Response if any ID is invalid, undefined if all valid or array is empty/undefined.
 */
export function validateTypeIdArray(
  values: string[] | undefined,
  prefix: IdPrefix,
  paramName = 'IDs'
): Response | undefined {
  if (!values || values.length === 0) return undefined
  for (const value of values) {
    if (!isValidTypeId(value, prefix)) {
      return badRequestResponse(`Invalid ${paramName} format`)
    }
  }
  return undefined
}
