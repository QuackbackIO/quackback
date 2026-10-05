import type { PostHog } from 'posthog-js'

/**
 * Explicit product events (funnel steps a pageview cannot express), sent
 * only once ProductAnalytics has started the SDK. Without a configured key
 * nothing is started, so a call is a no-op and never fetches the SDK.
 */
let client: PostHog | null = null

export function setAnalyticsClient(next: PostHog | null): void {
  client = next
}

export async function track(event: string, properties?: Record<string, unknown>): Promise<void> {
  try {
    client?.capture(event, properties)
  } catch {
    // Analytics must never break the flow it observes
  }
}

/**
 * Whether the browser asks not to be tracked: Do Not Track, or Global Privacy
 * Control (which some jurisdictions treat as a legal opt-out, and some
 * browsers send by default). Every analytics surface honours it the same way.
 */
export function browserOptedOutOfTracking(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true
}

/** An absolute URL without its query string or fragment; anything else as is. */
function withoutQuery(value: unknown): unknown {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return value
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value
  }
}

function scrubObject(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) out[key] = withoutQuery(value)
  return out
}

/**
 * Strips the query string and fragment from every URL an event carries
 * (`$current_url`, `$referrer` and their person-property copies). A sign-in
 * link, an OAuth callback or an emailed link can hold a credential there, and
 * nothing in a query string is worth sending. Campaign parameters are already
 * their own properties by the time an event reaches this.
 */
export function scrubEventUrls<T extends { properties?: Record<string, unknown> }>(event: T): T {
  if (!event.properties) return event
  const properties = scrubObject(event.properties)
  for (const key of ['$set', '$set_once']) {
    const nested = event.properties[key]
    if (nested && typeof nested === 'object') {
      properties[key] = scrubObject(nested as Record<string, unknown>)
    }
  }
  return { ...event, properties }
}
