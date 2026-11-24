import { createFileRoute } from '@tanstack/react-router'
import { consentPageLocation } from '@/lib/shared/oauth-consent-query'

/**
 * Better Auth's consent page (`consentPage`): hands the signed authorize query
 * to `/oauth/consent` in one param, unchanged, so the page can post it back
 * and the signature still matches. See lib/shared/oauth-consent-query.ts.
 */
export const Route = createFileRoute('/oauth/consent_/start')({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(null, {
          status: 302,
          headers: {
            Location: consentPageLocation(new URL(request.url).search),
            'Cache-Control': 'no-store',
          },
        }),
    },
  },
})
