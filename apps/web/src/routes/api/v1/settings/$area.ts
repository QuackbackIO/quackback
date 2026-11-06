import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  badRequestResponse,
  errorResponse,
  handleDomainError,
  successResponse,
} from '@/lib/server/domains/api/responses'
import {
  assertSettingsScope,
  changeResponse,
  settingsCallerFromApiAuth,
  withEtag,
} from '@/lib/server/domains/settings-registry/http'

export const Route = createFileRoute('/api/v1/settings/$area')({
  server: {
    handlers: {
      /**
       * GET /api/v1/settings/:area
       * One area's value, revision (also the ETag) and locked fields
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request)
          assertSettingsScope(auth, 'read:settings')
          const { readSettingsArea } =
            await import('@/lib/server/domains/settings-registry/service')
          const read = await readSettingsArea(settingsCallerFromApiAuth(auth).actor, params.area)
          return withEtag(successResponse(read), read.revision)
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/settings/:area
       * Merge patch with If-Match. Applies the change and answers with a
       * receipt. ?dry_run=true previews the change.
       */
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request)
          assertSettingsScope(auth, 'write:settings')
          const dryRun = new URL(request.url).searchParams.get('dry_run') === 'true'
          const ifMatch = request.headers.get('if-match')
          if (!dryRun && !ifMatch?.trim())
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

          const { changeSettingsArea } =
            await import('@/lib/server/domains/settings-registry/service')
          return changeResponse(
            await changeSettingsArea(settingsCallerFromApiAuth(auth), params.area, {
              patch,
              expectedRevision: ifMatch,
              dryRun,
            })
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
