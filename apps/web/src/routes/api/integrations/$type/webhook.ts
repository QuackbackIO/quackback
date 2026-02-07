import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/integrations/$type/webhook')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { handleInboundWebhook } =
          await import('@/lib/server/integrations/inbound-webhook-handler')
        return handleInboundWebhook(request, params.type)
      },
    },
  },
})
