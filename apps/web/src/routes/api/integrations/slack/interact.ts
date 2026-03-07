import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/integrations/slack/interact')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleSlackInteractivity } =
          await import('@/lib/server/integrations/slack/interactivity')
        return handleSlackInteractivity(request)
      },
    },
  },
})
