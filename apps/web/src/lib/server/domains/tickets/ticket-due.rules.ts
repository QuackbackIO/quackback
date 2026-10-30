/**
 * Server-side due-date validation, shared by the create path
 * (`createTicketCore`) and the setter (`setTicketDueAt`). Kept apart from
 * ticket-due.service.ts so the intake service can import it without a cycle
 * (the setter imports `publishTicketUpdated` from the intake service).
 */
import { ValidationError } from '@/lib/shared/errors'
import { ticketDueProblem, type TicketDueAudience } from '@/lib/shared/ticket-due'

const PROBLEM_MESSAGES = {
  invalid: 'Due date is not a valid date',
  past: 'Due date cannot be in the past',
  too_far: 'Due date is too far in the future',
  too_old: 'Due date is too far in the past',
} as const

/**
 * Throw `ValidationError('INVALID_DUE_DATE')` when `at` falls outside the
 * window for `audience`: a customer filing a ticket may pick today up to two
 * years ahead; a teammate may record anything from a year back to five years
 * ahead.
 */
export function assertTicketDueAt(
  at: Date,
  audience: TicketDueAudience,
  now: Date = new Date()
): void {
  const problem = ticketDueProblem(at, audience, now)
  if (problem) throw new ValidationError('INVALID_DUE_DATE', PROBLEM_MESSAGES[problem])
}
