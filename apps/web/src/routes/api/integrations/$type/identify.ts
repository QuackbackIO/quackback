import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/integrations/$type/identify')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { handleInboundIdentify } =
          await import('@/lib/server/integrations/user-sync-handler')
        return handleInboundIdentify(request, params.type)
      },
    },
  },
})
