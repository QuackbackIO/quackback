/**
 * The refusal a blocked person gets when they post, vote, comment, react or
 * upload on the portal or in the widget. End users see it, so it is neutral.
 * The server throws it as a typed error and the portal and widget recognise it
 * by its code to show their own translation.
 */
export const PERSON_BLOCKED_CODE = 'BLOCKED'

export const PERSON_BLOCKED_MESSAGE = "You can't post, vote or comment here."

/** Whether a failed call is the blocked-person refusal (matched by its code). */
export function isPersonBlockedRefusal(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === PERSON_BLOCKED_CODE
  )
}
