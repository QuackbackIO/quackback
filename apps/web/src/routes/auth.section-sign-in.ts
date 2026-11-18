import { createFileRoute } from '@tanstack/react-router'

/**
 * Provider sign-in for a visitor on a section host, run on the primary
 * domain. See lib/server/auth/section-sign-in.ts.
 */
export const Route = createFileRoute('/auth/section-sign-in')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { startSectionSignIn } = await import('@/lib/server/auth/section-sign-in')
        return startSectionSignIn(request)
      },
    },
  },
})
