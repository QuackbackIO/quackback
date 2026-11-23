import { UNEXPECTED_ERROR_MESSAGE } from '@/lib/shared/error-reference'
import { STALE_BUILD_HEADER, STALE_BUILD_MESSAGE } from '@/lib/shared/stale-build'

/**
 * The fetch every server function call in the browser goes through
 * (registered in start.ts).
 *
 * A server function answers in the framework's own format, marked by a header,
 * whether it returned or threw. A 5xx without that mark is not an answer from
 * the function at all: a proxy answered while the app was restarting, or the
 * server failed before reaching the function. The framework hands such a JSON
 * body to the caller as if it were the result, so the call resolves with
 * something like `{ status: 500 }` and the screen breaks later. Fail the call
 * here instead, with the plain sentence every toast and inline error already
 * knows how to show.
 *
 * A call this page's build makes to a function the server no longer has is
 * answered as a stale build (see lib/shared/stale-build.ts): the page reloads
 * once to pick up the new build, and the call fails either way.
 */
export async function serverFnFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, init)
  if (response.headers.get(STALE_BUILD_HEADER)) {
    reloadForNewBuild()
    throw new Error(STALE_BUILD_MESSAGE)
  }
  if (
    response.status >= 500 &&
    !response.headers.get('x-tss-serialized') &&
    response.headers.get('x-tss-raw') !== 'true'
  ) {
    throw new Error(UNEXPECTED_ERROR_MESSAGE)
  }
  return response
}

const RELOAD_KEY = 'qb-stale-build-reload'
// A reload that did not cure it (a cache still serving the old build) must not
// turn into a loop; after this long a later update may reload again.
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000

/**
 * Reload the page unless this tab already did so recently. The marker is
 * written before reloading, so calls failing together reload once. Without
 * storage there is no way to remember the reload across it, so the page does
 * not reload and the call's error is shown instead.
 */
export function reloadForNewBuild(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY))
    if (last && now - last < RELOAD_COOLDOWN_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(now))
  } catch {
    return false
  }
  window.location.reload()
  return true
}
