import { withApiHandler, successResponse } from '@/lib/api-handler'
import { getOrganizationFeatures } from '@/lib/features/server'

/**
 * GET /api/organization/features?organizationId={id}
 *
 * Get feature access info for an organization.
 * Returns edition, tier, enabled features, and limits.
 */
export const GET = withApiHandler(async (_request, { validation }) => {
  const features = await getOrganizationFeatures(validation.organization.id)

  return successResponse({
    edition: features.edition,
    tier: features.tier,
    enabledFeatures: features.enabledFeatures,
    limits: features.limits,
  })
})
