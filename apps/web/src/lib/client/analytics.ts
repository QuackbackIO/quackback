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
