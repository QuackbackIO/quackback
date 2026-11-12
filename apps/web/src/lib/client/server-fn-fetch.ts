import { UNEXPECTED_ERROR_MESSAGE } from '@/lib/shared/error-reference'

/**
 * The fetch every server function call in the browser goes through
 * (registered in start.ts).
 *
 * A server function answers in the framework's own format, marked by a header,
 * whether it returned or threw. A 5xx without that mark is not an answer from
 * the function at all: the function was removed by an update this tab has not
 * loaded yet, or a proxy answered while the app was restarting. The framework
 * hands such a JSON body to the caller as if it were the result, so the call
 * resolves with something like `{ status: 500 }` and the screen breaks later.
 * Fail the call here instead, with the plain sentence every toast and inline
 * error already knows how to show.
 */
export async function serverFnFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, init)
  if (
    response.status >= 500 &&
    !response.headers.get('x-tss-serialized') &&
    response.headers.get('x-tss-raw') !== 'true'
  ) {
    throw new Error(UNEXPECTED_ERROR_MESSAGE)
  }
  return response
}
