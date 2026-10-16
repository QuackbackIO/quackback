/**
 * Status mapping resolution.
 *
 * Maps external platform status names to Quackback StatusIds
 * using the statusMappings stored in integrations.config.
 */

import type { PostStatusId, TicketStatusId } from '@quackback/ids'

/**
 * Status mappings stored in integrations.config.statusMappings.
 * Key = external status name (case-sensitive as received from platform).
 * Value = Quackback PostStatusId or null (ignore this status).
 */
export type StatusMappings = Record<string, string | null>

/**
 * The mapping for an external status name, falling back to `fallbackStatus`
 * when the name has no entry at all. An entry mapped to null (ignore) does
 * not fall back.
 */
function mappedStatus(
  externalStatus: string,
  mappings: StatusMappings | undefined,
  fallbackStatus?: string
): string | null {
  if (!mappings) return null
  const mapped =
    mappings[externalStatus] === undefined && fallbackStatus
      ? mappings[fallbackStatus]
      : mappings[externalStatus]
  return mapped ?? null
}

/**
 * Resolve an external status name to a Quackback PostStatusId.
 * Returns null if no mapping exists or the mapping explicitly says to ignore.
 */
export function resolveStatusMapping(
  externalStatus: string,
  mappings: StatusMappings | undefined,
  fallbackStatus?: string
): PostStatusId | null {
  return mappedStatus(externalStatus, mappings, fallbackStatus) as PostStatusId | null
}

/**
 * Resolve an external status name to a Quackback TicketStatusId, using the
 * ticketStatusMappings stored in integrations.config (the ticket-side sibling
 * of statusMappings — same shape, resolving to ticket_statuses ids).
 * Returns null if no mapping exists or the mapping explicitly says to ignore.
 */
export function resolveTicketStatusMapping(
  externalStatus: string,
  mappings: StatusMappings | undefined,
  fallbackStatus?: string
): TicketStatusId | null {
  return mappedStatus(externalStatus, mappings, fallbackStatus) as TicketStatusId | null
}
