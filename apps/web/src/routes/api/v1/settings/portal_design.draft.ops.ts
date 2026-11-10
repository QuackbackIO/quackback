import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  badRequestResponse,
  errorResponse,
  handleDomainError,
  successResponse,
} from '@/lib/server/domains/api/responses'
import { withEtag } from '@/lib/server/domains/settings-registry/http'

export const Route = createFileRoute('/api/v1/settings/portal_design/draft/ops')({
  server: {
    handlers: {
      /**
       * POST /api/v1/settings/portal_design/draft/ops
       * The builder's operations on the draft, in order, such as setting one
       * block's setting or removing one block, with the builder's refusals.
       * If-Match must carry the revision you read. A refused operation changes
       * nothing and the rest still apply. Nothing goes live until a person
       * publishes the draft.
       */
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request)
          const http = await import('@/lib/server/domains/design/http')
          http.assertDesignAccess(auth, 'write:settings')
          const ifMatch = request.headers.get('if-match')
          if (!ifMatch?.trim())
            return errorResponse(
              'IF_MATCH_REQUIRED',
              'Send the revision you read as the If-Match header.',
              428
            )
          let body: unknown
          try {
            body = await request.json()
          } catch {
            return badRequestResponse('Request body must be a JSON object')
          }
          const { apiDesignOps, applyDraftOps } =
            await import('@/lib/server/domains/design/draft-ops')
          const parsed = apiDesignOps.safeParse((body as { ops?: unknown } | null)?.ops)
          if (!parsed.success)
            return badRequestResponse('Send ops: a list of 1 to 50 design operations', {
              issues: parsed.error.issues.slice(0, 5).map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
              })),
            })
          const [{ normalizeRevision }, { workspaceGates }] = await Promise.all([
            import('@/lib/server/domains/settings-registry/service'),
            import('@/lib/server/domains/design/workspace-gates'),
          ])
          const result = await applyDraftOps(
            parsed.data,
            await http.designAuthorFromApiAuth(auth, request.headers),
            normalizeRevision(ifMatch),
            await workspaceGates()
          )
          if (!result.ok) return http.refusalResponse(result)
          const { applied, refused, revision } = result
          return withEtag(successResponse({ applied, refused, revision }), revision)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
