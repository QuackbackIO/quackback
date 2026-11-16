import { createFileRoute } from '@tanstack/react-router'

/**
 * The section handoff: begin and finish on the target host, mint on the
 * source host, picked by `leg`. See lib/shared/section-handoff.ts.
 */
export const Route = createFileRoute('/auth/section-handoff')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handoff = await import('@/lib/server/auth/section-handoff')
        // One route for all three steps keeps one entry in the route tree.
        switch (new URL(request.url).searchParams.get('leg')) {
          case 'mint':
            return handoff.mintSectionHandoff(request)
          case 'finish':
            return handoff.finishSectionHandoff(request)
          default:
            return handoff.beginSectionHandoff(request)
        }
      },
    },
  },
})
