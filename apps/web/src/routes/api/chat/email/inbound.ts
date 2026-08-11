import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/chat/email/inbound')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Two transports, one address. They are told apart by what they send:
        // the fleet's edge mail bridge POSTs raw MIME, the provider webhook
        // POSTs JSON. Each handler authenticates its own caller with its own
        // credential and 404s on its own configuration, so neither door opens on
        // the other's key and neither can be reached by claiming to be the
        // other.
        const { isCloudflareInboundRequest, handleCloudflareInboundEmail } =
          await import('@/lib/server/domains/conversation/email-cloudflare-handler')
        if (isCloudflareInboundRequest(request)) return handleCloudflareInboundEmail(request)

        const { handleInboundEmailWebhook } =
          await import('@/lib/server/domains/conversation/email-webhook-handler')
        return handleInboundEmailWebhook(request)
      },
    },
  },
})
