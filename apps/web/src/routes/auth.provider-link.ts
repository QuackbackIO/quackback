import { createFileRoute } from '@tanstack/react-router'

/**
 * Linking a provider for a visitor on a section host, run on the primary
 * domain. See lib/server/auth/section-link.ts.
 */
export const Route = createFileRoute('/auth/provider-link')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { startSectionLink } = await import('@/lib/server/auth/section-link')
        return startSectionLink(request)
      },
    },
  },
})
