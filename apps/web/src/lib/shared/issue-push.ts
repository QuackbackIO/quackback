/**
 * What a linked issue looks like for each ticket status, in a destination
 * that updates its issues automatically (`applyAutomatically`): the issue's
 * state, why a closed one closed, and a label to carry while the ticket sits
 * in that status. Client-safe, so the settings editor shows the same defaults
 * the server applies.
 *
 * Defaults derive from the status's category and requester-facing stage:
 *
 * - `open` (New, Investigating, Escalated): an open issue.
 * - `pending` awaiting the requester (Waiting on customer): open, labelled
 *   `waiting-on-customer`.
 * - any other `pending` (Waiting on third party): open, labelled `on-hold`.
 * - `closed` with the `resolved` stage (Resolved): closed as completed.
 * - any other `closed`, hidden from the requester (Won't do): closed as not
 *   planned.
 *
 * Quackback owns only the labels these mappings name (and `priority:*`): a
 * status change removes another status's label from the issue and adds its
 * own, and never touches a label it did not set.
 */
import type { TicketStage, TicketStatusCategory } from '@/lib/shared/db-types'

export const ISSUE_PUSH_STATES = ['open', 'closed'] as const
export type IssuePushStateName = (typeof ISSUE_PUSH_STATES)[number]

export const ISSUE_STATE_REASONS = ['completed', 'not_planned'] as const
export type IssueStateReason = (typeof ISSUE_STATE_REASONS)[number]

/** One ticket status's issue: its state, a closed one's reason, and an optional label. */
export interface IssuePushState {
  state: IssuePushStateName
  stateReason?: IssueStateReason
  label?: string
}

/**
 * Ticket status id → its issue, per destination. A missing status uses the
 * default; null leaves the issue alone while the ticket is in that status.
 */
export type IssuePushStateMappings = Record<string, IssuePushState | null>

/** The status label awaiting the requester gets by default. */
export const WAITING_ON_CUSTOMER_LABEL = 'waiting-on-customer'
/** The label any other pending status gets by default. */
export const ON_HOLD_LABEL = 'on-hold'
/** The prefix of the priority label an issue carries (`priority:high`). */
export const PRIORITY_LABEL_PREFIX = 'priority:'
/** GitHub caps a label name at 50 characters. */
export const ISSUE_LABEL_MAX = 50

export interface IssuePushStatus {
  id: string
  category: TicketStatusCategory
  publicStage: TicketStage | null
}

/** The issue a status gets when its destination says nothing about it. */
export function defaultIssuePushState(
  status: Pick<IssuePushStatus, 'category' | 'publicStage'>
): IssuePushState {
  if (status.category === 'closed')
    return status.publicStage === 'resolved'
      ? { state: 'closed', stateReason: 'completed' }
      : { state: 'closed', stateReason: 'not_planned' }
  if (status.category === 'pending')
    return {
      state: 'open',
      label:
        status.publicStage === 'awaiting_requester' ? WAITING_ON_CUSTOMER_LABEL : ON_HOLD_LABEL,
    }
  return { state: 'open' }
}

/** The issue a status gets in a destination: its mapping, else the default; null leaves it alone. */
export function issuePushStateFor(
  mappings: IssuePushStateMappings | null | undefined,
  status: IssuePushStatus
): IssuePushState | null {
  const mapped = mappings?.[status.id]
  if (mapped === null) return null
  return mapped ?? defaultIssuePushState(status)
}

/** Every status label a destination's mappings set: the labels Quackback owns there. */
export function ownedStatusLabels(
  mappings: IssuePushStateMappings | null | undefined,
  statuses: readonly IssuePushStatus[]
): string[] {
  const labels = new Set<string>()
  for (const status of statuses) {
    const label = issuePushStateFor(mappings, status)?.label
    if (label) labels.add(label)
  }
  return [...labels]
}

/** The label a ticket priority puts on an issue, or null for none. */
export function priorityLabel(priority: string): string | null {
  return priority && priority !== 'none' ? `${PRIORITY_LABEL_PREFIX}${priority}` : null
}
