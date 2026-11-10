import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { handleDomainError, noContentResponse } from '@/lib/server/domains/api/responses'

export const Route = createFileRoute('/api/v1/settings/portal_design/draft')({
  server: {
    handlers: {
      /**
       * DELETE /api/v1/settings/portal_design/draft
       * Discards the draft; the published design stays as it is. With
       * If-Match, a draft that moved on from that revision is kept and the
       * discard refused, as PATCH refuses a stale patch.
       */
      DELETE: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request)
          const http = await import('@/lib/server/domains/design/http')
          http.assertDesignAccess(auth, 'write:settings')
          const ifMatch = request.headers.get('if-match')?.trim()
          const { normalizeRevision } =
            await import('@/lib/server/domains/settings-registry/service')
          const { discardDesignDraft } = await import('@/lib/server/domains/design/design.actions')
          const result = await discardDesignDraft(
            ifMatch ? normalizeRevision(ifMatch) : undefined
          )
          if (!result.ok) return http.refusalResponse(result)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
