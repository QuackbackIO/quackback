import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/integrations/$type/hooks/$kind')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { handleAppHook } = await import('@/lib/server/integrations/app-hook-handler')
        return handleAppHook(request, params.type, params.kind)
      },
    },
  },
})
