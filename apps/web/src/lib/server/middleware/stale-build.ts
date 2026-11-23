/**
 * A server function call from a page built before the running server.
 *
 * Server functions are addressed by a build-derived id. After an update, a tab
 * still running the previous build keeps calling ids this build does not have,
 * and the framework's lookup throws before the function middleware runs, so
 * the call ended as an unhandled 500 logged at error. A tab that polls repeated
 * that for as long as it stayed open.
 *
 * Answer those with the stale-build response instead (see
 * lib/shared/stale-build.ts), which the browser reloads on, and log at warn
 * once per id. Every other failure is rethrown untouched.
 *
 * This only creates a response where the framework had none; it never replaces
 * one that `next()` produced.
 */
import { createMiddleware } from '@tanstack/react-start'
import type { AppLogger } from '@quackback/logger'
import { logger } from '@/lib/server/logger'
import {
  STALE_BUILD_HEADER,
  STALE_BUILD_MESSAGE,
  STALE_BUILD_STATUS,
} from '@/lib/shared/stale-build'

/**
 * The lookup failure, as a production build words it and as the dev server
 * words it. "Server function not accessible from client" is a different case
 * (a server-only function) and stays an error.
 */
const UNKNOWN_ID = /^(?:Server function info not found for |Invalid server function ID: )(.*)$/

/** The unknown id the error names, or null when it is any other failure. */
export function unknownServerFnId(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  const match = UNKNOWN_ID.exec(error.message)
  return match ? match[1] : null
}

export function staleBuildResponse(): Response {
  return new Response(STALE_BUILD_MESSAGE, {
    status: STALE_BUILD_STATUS,
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'cache-control': 'no-store',
      [STALE_BUILD_HEADER]: '1',
    },
  })
}

// Ids come from the caller, so both the set and each entry are bounded.
const MAX_LOGGED_IDS = 1000
const loggedStaleIds = new Set<string>()

/** True the first time this process sees an id (until the set fills and resets). */
function firstSighting(id: string): boolean {
  const key = id.slice(0, 200)
  if (loggedStaleIds.has(key)) return false
  if (loggedStaleIds.size >= MAX_LOGGED_IDS) loggedStaleIds.clear()
  loggedStaleIds.add(key)
  return true
}

interface NextResult {
  response?: Response
}

export async function handleStaleBuild<T extends NextResult>({
  handlerType,
  next,
  log = logger,
}: {
  handlerType: string
  next: () => Promise<T>
  log?: AppLogger
}): Promise<T | Response> {
  if (handlerType !== 'serverFn') return next()
  try {
    return await next()
  } catch (error) {
    const id = unknownServerFnId(error)
    if (id === null) throw error
    if (firstSighting(id)) {
      log.warn(
        { server_fn_id: id.slice(0, 200) },
        'server function from an older build called; asking the page to reload'
      )
    }
    return staleBuildResponse()
  }
}

export const staleBuildMiddleware = createMiddleware().server(({ next, handlerType }) =>
  handleStaleBuild({ handlerType, next: () => Promise.resolve(next()) })
)
