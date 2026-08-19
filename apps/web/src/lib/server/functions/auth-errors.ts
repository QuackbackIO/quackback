/**
 * The auth-denial error vocabulary and its matcher, as a pure leaf module with
 * no import graph of its own. `requireAuth` / `assertPermission`
 * (auth-helpers.ts) throw plain Errors in this vocabulary — no typed error
 * class exists at that seam — so callers that map a denial onto their own
 * error shape discriminate on the messages. Extracted from auth-helpers.ts so
 * a consumer (or a test) can reach the REAL matcher without pulling in the
 * auth stack that auth-helpers itself imports; auth-helpers re-exports it, so
 * the vocabulary still lives beside the throws for existing importers.
 */

/**
 * Whether an error is the denial half of `requireAuth`'s throw vocabulary
 * ('Authentication required', 'Access denied: …'). Deliberately excludes
 * 'Workspace not configured': that is a server-side misconfiguration, not
 * something the caller's credentials can fix, so it belongs with the
 * rethrown 500s.
 */
export function isAuthDenialError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.startsWith('Authentication required') || err.message.startsWith('Access denied'))
  )
}
