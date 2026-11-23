/**
 * The answer to a server function call from a page built before the running
 * server (a tab opened before an update and never reloaded). Server functions
 * are addressed by an id derived from the build, so the old page asks for ids
 * the new server does not have.
 *
 * The server answers 409 with this header (stale-build.ts in the server
 * middleware) and the browser reloads once (server-fn-fetch.ts). 409 rather
 * than 410 because a 410 may be cached without any cache header, and this
 * answer is only true for the page that asked.
 *
 * The body is the plain sentence below, not JSON: a page built before this
 * answer existed fails the call with the body as the error message, so it
 * still tells the person what to do.
 */
export const STALE_BUILD_STATUS = 409
export const STALE_BUILD_HEADER = 'x-stale-build'
export const STALE_BUILD_MESSAGE = 'This page is out of date. Reload the page to continue.'
