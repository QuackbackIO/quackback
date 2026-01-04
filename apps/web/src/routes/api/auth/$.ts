import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      /**
       * GET /api/auth/*
       * Better-auth catch-all route handler
       */
      GET: async ({ request }) => {
        // Dynamic import to prevent client bundling of auth config
        const { auth } = await import('@/lib/auth/index')
        return await auth.handler(request)
      },

      /**
       * POST /api/auth/*
       * Better-auth catch-all route handler
       */
      POST: async ({ request }) => {
        // Dynamic import to prevent client bundling of auth config
        const { auth } = await import('@/lib/auth/index')
        return await auth.handler(request)
      },
    },
  },
})
