import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/oauth/connector/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleConnectorOAuthCallback } =
          await import('@/lib/server/domains/assistant/connectors/oauth-callback')
        return handleConnectorOAuthCallback(request)
      },
    },
  },
})
