import { createFileRoute } from '@tanstack/react-router'

/**
 * POST /api/v1/setup
 *
 * First-run setup without the browser wizard: creates the workspace and its
 * first admin and returns a workspace API key with the Owner role. Authenticated by the
 * operator's setup token (`SETUP_TOKEN`, or the one printed on first boot), and
 * only while the install has no admin.
 */
export const Route = createFileRoute('/api/v1/setup')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleSetupRequest } = await import('@/lib/server/domains/onboarding/setup-request')
        return handleSetupRequest(request)
      },
    },
  },
})
