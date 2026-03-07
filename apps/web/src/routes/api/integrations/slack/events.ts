import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/integrations/slack/events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleSlackEvents } = await import('@/lib/server/integrations/slack/events')
        return handleSlackEvents(request)
      },
    },
  },
})
