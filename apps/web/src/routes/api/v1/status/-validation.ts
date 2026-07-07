/**
 * Shared request-validation helpers for the /api/v1/status/* routes.
 * Not a route itself (the `-` prefix opts it out of file-based routing).
 */
import { isValidTypeId, type IdPrefix } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'

export const STATUS_COMPONENT_STATUSES = [
  'operational',
  'degraded_performance',
  'partial_outage',
  'major_outage',
  'under_maintenance',
] as const

/** Union of the incident and maintenance lifecycles — the domain's
 *  `CreateStatusIncidentInput.status` type accepts either, disambiguated by
 *  `kind`. We validate against the union rather than re-deriving the
 *  kind -> vocabulary mapping here; an incompatible (kind, status) pair is
 *  still a client input error, but not one this thin layer needs to police
 *  ahead of the domain. */
export const STATUS_INCIDENT_LIFECYCLE_STATUSES = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
  'scheduled',
  'in_progress',
  'verifying',
  'completed',
] as const

export const STATUS_INCIDENT_IMPACTS = [
  'none',
  'minor',
  'major',
  'critical',
  'maintenance',
] as const

/**
 * Like `parseOptionalTypeId`, but preserves an explicit `null` distinctly
 * from an absent `undefined` — needed for nullable update inputs (e.g.
 * `UpdateStatusComponentInput.groupId`) where `null` means "clear this
 * field" and `undefined` means "leave it untouched".
 */
export function parseNullableTypeId<T extends string>(
  value: string | null | undefined,
  prefix: IdPrefix,
  paramName = 'ID'
): T | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!isValidTypeId(value, prefix)) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid ${paramName} format`)
  }
  return value as T
}

/**
 * ISO datetime string -> Date, preserving `null` (clear) vs. `undefined`
 * (untouched) — mirrors `parseNullableTypeId`'s distinction for date fields
 * like `scheduledStartAt`/`scheduledEndAt`.
 */
export function parseOptionalDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return new Date(value)
}
