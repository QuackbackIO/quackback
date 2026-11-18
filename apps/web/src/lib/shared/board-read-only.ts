/**
 * The refusal a read-only board gives. End users see it, so it is neutral: it
 * never mentions plans or billing. The server throws it as a domain error and
 * the portal and widget recognise it by this message to show their own
 * translation.
 */
export const BOARD_READ_ONLY_MESSAGE = "This board isn't taking new feedback right now."

export function isBoardReadOnlyError(error: unknown): boolean {
  return error instanceof Error && error.message === BOARD_READ_ONLY_MESSAGE
}
