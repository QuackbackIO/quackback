import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      /**
       * GET /api/auth/*
       * Better-auth catch-all route handler
       */
      GET: async ({ request }) => {
        const url = new URL(request.url)
        console.log(`[auth] GET ${url.pathname.replace('/api/auth', '')}`)

        // Dynamic import to prevent client bundling of auth config
        const { auth } = await import('@/lib/auth/index')
        return await auth.handler(request)
      },

      /**
       * POST /api/auth/*
       * Better-auth catch-all route handler
       */
      POST: async ({ request }) => {
        const url = new URL(request.url)
        console.log(`[auth] POST ${url.pathname.replace('/api/auth', '')}`)

        // Dynamic import to prevent client bundling of auth config
        const { auth } = await import('@/lib/auth/index')
        return await auth.handler(request)
      },
    },
  },
})
