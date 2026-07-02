/**
 * GET /api/v1/changelog/visibility — read org-level changelog visibility config
 * PUT /api/v1/changelog/visibility — replace org-level changelog visibility config
 *
 * Org defaults that gate which changelog categories/products portal users see.
 * Per-segment overrides live under /changelog/visibility/segments. Changelog is
 * a feedback-plane resource, so these endpoints are role-gated (team read,
 * admin write) rather than scope-gated.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { changelogVisibilityConfigSchema } from '@/lib/shared/schemas/changelog-visibility'

export const Route = createFileRoute('/api/v1/changelog/visibility')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })
          const { getOrgChangelogVisibility } =
            await import('@/lib/server/domains/changelog/changelog-visibility.service')
          const config = await getOrgChangelogVisibility()
          return successResponse(config)
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PUT: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { role: 'admin' })
          const body = await request.json().catch(() => null)
          const parsed = changelogVisibilityConfigSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { setOrgChangelogVisibility, getOrgChangelogVisibility } =
            await import('@/lib/server/domains/changelog/changelog-visibility.service')
          await setOrgChangelogVisibility(parsed.data)
          return successResponse(await getOrgChangelogVisibility())
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
