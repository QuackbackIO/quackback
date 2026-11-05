import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId, UserId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { getStarPromptStage } from '@/lib/server/github-star-prompt'
import { readStarCount } from '@/lib/server/github-star-count'
import { markOnboardingProgress } from '@/lib/server/onboarding-progress'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { StarPromptStage } from '@/lib/shared/github-star-prompt'

export interface StarPromptState {
  stage: StarPromptStage
  stars: number | null
}

/** Whether this team member may be asked for a GitHub star, and where. */
export const getStarPromptFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StarPromptState> => {
    const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
    const stage = await getStarPromptStage(auth.user.id as UserId, auth.principal.id as PrincipalId)
    return { stage, stars: stage ? await readStarCount() : null }
  }
)

/**
 * Claim the prompt before showing it. The marker is set under a row lock and
 * only the first claim wins, so two tabs can never both show it. After this
 * it never shows to this person again, whatever they choose.
 */
export const markStarPromptShownFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
  return { claimed: await markOnboardingProgress(auth.user.id as UserId, 'githubStarPromptAt') }
})
