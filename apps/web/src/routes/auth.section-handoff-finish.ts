import { createFileRoute } from '@tanstack/react-router'

/** Leg 3 of the section handoff, back on the target host. See lib/shared/section-handoff.ts. */
export const Route = createFileRoute('/auth/section-handoff-finish')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { finishSectionHandoff } = await import('@/lib/server/auth/section-handoff')
        return finishSectionHandoff(request)
      },
    },
  },
})
