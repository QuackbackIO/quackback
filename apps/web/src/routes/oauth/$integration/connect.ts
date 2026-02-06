import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/oauth/$integration/connect')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { handleOAuthConnect } = await import('@/lib/server/integrations/oauth-handlers')
        return handleOAuthConnect(request, params.integration)
      },
    },
  },
})
