import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import {
  assertSettingsScope,
  settingsCallerFromApiAuth,
} from '@/lib/server/domains/settings-registry/http'

export const Route = createFileRoute('/api/v1/settings/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/settings
       * The settings areas the key may read, with revision and gates
       */
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request)
          assertSettingsScope(auth, 'read:settings')
          const { listSettingsAreas } =
            await import('@/lib/server/domains/settings-registry/service')
          return successResponse(await listSettingsAreas(settingsCallerFromApiAuth(auth).actor))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
