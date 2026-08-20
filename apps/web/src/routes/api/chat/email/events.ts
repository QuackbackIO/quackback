import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/chat/email/events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleEmailDeliveryWebhook } =
          await import('@/lib/server/email/email-delivery-webhook')
        return handleEmailDeliveryWebhook(request)
      },
    },
  },
})
