import { createFileRoute } from '@tanstack/react-router'
import { corsHeaders, preflightResponse } from '@/lib/server/integrations/apps/cors'
import { recordPageView } from '@/lib/server/domains/analytics/track.service'

/**
 * Public, anonymous pageview beacon for portal + widget visitor analytics.
 *
 * Cross-origin by design: the widget fires from the embedding site's
 * top-level page, so responses carry wildcard CORS (no credentials read).
 * The body is text/plain so fetch({keepalive}) and sendBeacon stay CORS
 * simple requests. Always answers 204 — invalid input is dropped, never
 * signaled.
 */
export const Route = createFileRoute('/api/track')({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),

      POST: async ({ request }) => {
        await recordPageView(request)
        return new Response(null, { status: 204, headers: corsHeaders() })
      },
    },
  },
})
