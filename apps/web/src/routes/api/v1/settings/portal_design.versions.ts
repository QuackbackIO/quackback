import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { handleDomainError, successResponse } from '@/lib/server/domains/api/responses'

export const Route = createFileRoute('/api/v1/settings/portal_design/versions')({
  server: {
    handlers: {
      /**
       * GET /api/v1/settings/portal_design/versions
       * Published versions, newest first
       */
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request)
          const { assertDesignAccess } = await import('@/lib/server/domains/design/http')
          assertDesignAccess(auth, 'read:settings')
          const { listDesignVersions } = await import('@/lib/server/domains/design/design.actions')
          return successResponse(await listDesignVersions())
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
