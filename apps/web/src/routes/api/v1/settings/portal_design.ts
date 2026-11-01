import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  badRequestResponse,
  errorResponse,
  handleDomainError,
  successResponse,
} from '@/lib/server/domains/api/responses'
import { withEtag } from '@/lib/server/domains/settings-registry/http'

export const Route = createFileRoute('/api/v1/settings/portal_design')({
  server: {
    handlers: {
      /**
       * GET /api/v1/settings/portal_design
       * The design being edited (the draft, else the published design, else
       * the branding converted), its contrast report and its revision (also
       * the ETag)
       */
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request)
          const { assertDesignAccess } = await import('@/lib/server/domains/design/http')
          assertDesignAccess(auth, 'read:settings')
          const { readDesignForEditing } =
            await import('@/lib/server/domains/design/design.actions')
          const state = await readDesignForEditing()
          return withEtag(successResponse(state), state.revision)
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/settings/portal_design
       * A JSON merge patch onto the design being edited, saved as the draft.
       * If-Match must carry the revision you read. Nothing goes live until a
       * person publishes the draft.
       */
      PATCH: async ({ request }) => {
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
          let patch: unknown
          try {
            patch = await request.json()
          } catch {
            return badRequestResponse('Request body must be a JSON object')
          }
          if (patch === null || typeof patch !== 'object' || Array.isArray(patch))
            return badRequestResponse('Request body must be a JSON object')

          const { normalizeRevision } =
            await import('@/lib/server/domains/settings-registry/service')
          const actions = await import('@/lib/server/domains/design/design.actions')
          const result = await actions.patchDesignDraft(
            patch,
            await http.designAuthorFromApiAuth(auth, request.headers),
            normalizeRevision(ifMatch)
          )
          if (!result.ok) return http.refusalResponse(result)
          const state = await actions.readDesignForEditing()
          return withEtag(successResponse(state), state.revision)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
