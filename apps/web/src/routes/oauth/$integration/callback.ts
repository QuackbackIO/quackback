import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/oauth/$integration/callback')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { handleOAuthCallback } = await import('@/lib/server/integrations/oauth-handlers')
        return handleOAuthCallback(request, params.integration)
      },
    },
  },
})
