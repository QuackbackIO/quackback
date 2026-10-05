import { createFileRoute } from '@tanstack/react-router'
import { config } from '@/lib/server/config'
import { relayToPostHog } from '@/lib/server/analytics-relay'

/**
 * First-party path for the product analytics SDK (see analytics-relay.ts).
 * Answers 404 unless the operator configured product analytics.
 */
function relay(request: Request): Promise<Response> | Response {
  const analytics = config.productAnalytics
  if (!analytics) return new Response(null, { status: 404 })
  return relayToPostHog(request, { apiHost: analytics.host, prefix: '/api/relay' })
}

export const Route = createFileRoute('/api/relay/$')({
  server: {
    handlers: {
      GET: ({ request }) => relay(request),
      POST: ({ request }) => relay(request),
    },
  },
})
