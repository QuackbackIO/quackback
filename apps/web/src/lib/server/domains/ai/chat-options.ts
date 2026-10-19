/**
 * Options every `chat()` call spreads in so the library stays quiet.
 *
 * By default TanStack AI reports a failed call on the console (`console.error`
 * plus a `console.dir` of the error payload) before the caller's own catch
 * runs. The payload is the provider's error, whose message and body can quote
 * the request (a rejected prompt, a validation detail naming a field's value).
 * The caller still receives the error and decides what is safe to log, so the
 * library's own copy is turned off rather than left to reach stdout.
 */
export const AI_CHAT_OPTIONS = { debug: false as const }
