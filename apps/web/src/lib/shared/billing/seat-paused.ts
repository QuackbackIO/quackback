/**
 * A team member whose seat is paused: the workspace's plan includes fewer team
 * seats than it has members, and this person is not one of the seat holders.
 *
 * The refusal travels as a plain auth denial ("Access denied: ..."), so the
 * server keeps its message in production and logs it as a warning, and the
 * admin's error boundary can tell it from any other denial by its text.
 */
export const SEAT_PAUSED_DENIAL = 'Access denied: Your seat is paused'

/** Whether an error (or a serialized `{ message }` payload) is the paused-seat refusal. */
export function isSeatPausedError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error !== null && typeof error === 'object' && 'message' in error
        ? (error as { message: unknown }).message
        : null
  return typeof message === 'string' && message.startsWith(SEAT_PAUSED_DENIAL)
}
