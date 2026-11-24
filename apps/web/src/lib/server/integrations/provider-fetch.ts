/**
 * The one `fetch` every chat and issue-tracker integration uses to reach its
 * provider (directly, or through `integrationFetch`).
 *
 * In production it is `fetch`, called with the same arguments. Only in an e2e
 * run, behind the harness gate, does it send requests for the known provider
 * hosts to the local provider fake (see e2e-harness/provider-fake.ts).
 */
import { e2eProviderFakeUrl } from '@/lib/server/e2e-harness/provider-fake'

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

export function providerFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const fake = e2eProviderFakeUrl(requestUrl(input))
  if (fake) {
    const target = input instanceof Request ? new Request(fake, input) : fake
    return fetch(target, init)
  }
  return init === undefined ? fetch(input) : fetch(input, init)
}
