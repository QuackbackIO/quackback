import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/lib/auth/index'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      /**
       * GET /api/auth/*
       * Better-auth catch-all route handler
       */
      GET: async ({ request }) => {
        // Better-auth handles the request internally
        return await auth.handler(request)
      },

      /**
       * POST /api/auth/*
       * Better-auth catch-all route handler
       */
      POST: async ({ request }) => {
        // Better-auth handles the request internally
        return await auth.handler(request)
      },
    },
  },
})
