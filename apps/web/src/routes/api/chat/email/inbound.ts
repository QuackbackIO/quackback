import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/chat/email/inbound')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleInboundEmailWebhook } =
          await import('@/lib/server/domains/conversation/email-webhook-handler')
        return handleInboundEmailWebhook(request)
      },
    },
  },
})
