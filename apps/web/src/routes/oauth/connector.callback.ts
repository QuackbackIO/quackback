import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/oauth/connector/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { finishConnectorOAuth } =
          await import('@/lib/server/domains/assistant/connectors/oauth-provider')
        return finishConnectorOAuth(request)
      },
    },
  },
})
