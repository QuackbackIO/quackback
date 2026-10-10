import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/oauth/$integration/callback')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { handleOAuthCallback } = await import('@/lib/server/integrations/oauth-handlers')
        return handleOAuthCallback(request, params.integration)
      },
      // The shared callback verifies state, cookie, dashboard session, and browser origin.
      POST: async ({ request, params }) => {
        const { handleOAuthCallback } = await import('@/lib/server/integrations/oauth-handlers')
        const { oauthFragmentResult } = await import('@/lib/server/integrations/oauth-fragment')
        return oauthFragmentResult(await handleOAuthCallback(request, params.integration))
      },
    },
  },
})
