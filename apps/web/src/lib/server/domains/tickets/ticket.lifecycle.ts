/**
 * Pure ticket lifecycle rules (support platform §4.2), separated from the db so
 * they can be unit-tested without a connection. The service composes these into
 * its update patches.
 */
import type { TicketStatusCategory, TicketStage } from '@/lib/shared/db-types'
import type { TicketStatusEntity } from '@/lib/server/db'

/**
 * The requester-facing stage a status projects to. A NULL `public_stage` hides
 * the status from the requester entirely (internal-only states never leak).
 */
export function resolveStage(status: Pick<TicketStatusEntity, 'publicStage'>): TicketStage | null {
  return status.publicStage ?? null
}

/**
 * How a status change touches the resolution columns.
 * - `resolvedAt`: a `Date` to stamp (entering closed), `null` to clear
 *   (reopening), or `undefined` to leave untouched (any other move).
 * - `reopenedIncrement`: 1 when moving out of a closed status, else 0.
 */
export interface StatusTransition {
  resolvedAt: Date | null | undefined
  reopenedIncrement: 0 | 1
}

/**
 * Resolve the lifecycle effect of moving from one status category to another.
 * Entering `closed` from a non-closed status stamps `resolvedAt`; leaving
 * `closed` clears it and counts a reopen. Moves that stay inside (or between two
 * non-closed) categories leave the resolution columns alone.
 */
export function statusTransition(
  from: TicketStatusCategory,
  to: TicketStatusCategory,
  now: Date = new Date()
): StatusTransition {
  const enteringClosed = to === 'closed' && from !== 'closed'
  const leavingClosed = from === 'closed' && to !== 'closed'
  if (enteringClosed) return { resolvedAt: now, reopenedIncrement: 0 }
  if (leavingClosed) return { resolvedAt: null, reopenedIncrement: 1 }
  return { resolvedAt: undefined, reopenedIncrement: 0 }
}

/**
 * The `first_response_at` value for an agent action: the current time the first
 * time an agent touches a ticket, `undefined` (leave as-is) afterwards or when
 * the actor is not an agent. Stamped once and never overwritten.
 */
export function firstResponseStamp(
  existing: Date | null,
  isAgentAction: boolean,
  now: Date = new Date()
): Date | undefined {
  return existing === null && isAgentAction ? now : undefined
}
