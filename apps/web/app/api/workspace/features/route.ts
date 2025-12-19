import { withApiHandler, successResponse } from '@/lib/api-handler'
import { getWorkspaceFeatures } from '@/lib/features/server'

/**
 * GET /api/workspace/features?workspaceId={id}
 *
 * Get feature access info for an organization.
 * Returns edition, tier, enabled features, and limits.
 */
export const GET = withApiHandler(async (_request, { validation }) => {
  const features = await getWorkspaceFeatures(validation.workspace.id)

  return successResponse({
    edition: features.edition,
    tier: features.tier,
    enabledFeatures: features.enabledFeatures,
    limits: features.limits,
  })
})
