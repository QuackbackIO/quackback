/**
 * Every outbound GitLab request goes through the SSRF guard.
 *
 * The instance URL is admin-supplied and only validated at save time; DNS
 * can change (or start redirecting to a private address) afterwards.
 * `safeFetch` re-validates on each call, connects to the validated IP
 * rather than re-resolving the hostname, and never follows redirects, so
 * the save-time check cannot be bypassed later.
 */

import { safeFetch, type SafeFetchInit } from '@/lib/server/content/ssrf-guard'

export const GITLAB_REQUEST_TIMEOUT_MS = 15_000
/** Project listings (100 per page) run well past the guard's 64 KiB default. */
export const GITLAB_MAX_RESPONSE_BYTES = 4 * 1024 * 1024

export function gitlabFetch(
  url: string,
  init: Pick<SafeFetchInit, 'method' | 'headers' | 'body' | 'timeoutMs'> = {}
): Promise<Response> {
  return safeFetch(url, {
    ...init,
    timeoutMs: init.timeoutMs ?? GITLAB_REQUEST_TIMEOUT_MS,
    maxResponseBytes: GITLAB_MAX_RESPONSE_BYTES,
    onOverflow: 'error',
  })
}
