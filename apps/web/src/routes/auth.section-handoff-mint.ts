import { createFileRoute } from '@tanstack/react-router'

/** Leg 2 of the section handoff, on the host the viewer is signed in on. See lib/shared/section-handoff.ts. */
export const Route = createFileRoute('/auth/section-handoff-mint')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { mintSectionHandoff } = await import('@/lib/server/auth/section-handoff')
        return mintSectionHandoff(request)
      },
    },
  },
})
