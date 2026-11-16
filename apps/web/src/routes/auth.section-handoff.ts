import { createFileRoute } from '@tanstack/react-router'

/** Leg 1 of the section handoff, on the target host. See lib/shared/section-handoff.ts. */
export const Route = createFileRoute('/auth/section-handoff')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { beginSectionHandoff } = await import('@/lib/server/auth/section-handoff')
        return beginSectionHandoff(request)
      },
    },
  },
})
