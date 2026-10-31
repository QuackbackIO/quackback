import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { handleDomainError, noContentResponse } from '@/lib/server/domains/api/responses'

export const Route = createFileRoute('/api/v1/settings/portal_design/draft')({
  server: {
    handlers: {
      /**
       * DELETE /api/v1/settings/portal_design/draft
       * Discards the draft; the published design stays as it is
       */
      DELETE: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request)
          const { assertDesignAccess } = await import('@/lib/server/domains/design/http')
          assertDesignAccess(auth, 'write:settings')
          const { discardDesignDraft } = await import('@/lib/server/domains/design/design.actions')
          await discardDesignDraft()
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
