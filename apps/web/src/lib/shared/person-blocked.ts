/**
 * The refusal a blocked person gets when they post, vote, comment, react or
 * upload on the portal or in the widget. End users see it, so it is neutral.
 * The server throws it as a typed error and the portal and widget recognise it
 * by its code (each with a local check, so no client chunk loads this module)
 * to show their own translation.
 */
export const PERSON_BLOCKED_CODE = 'BLOCKED'

export const PERSON_BLOCKED_MESSAGE = "You can't post, vote or comment here."
