import { createServerFn } from '@tanstack/react-start'
import { eq, db, user } from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { readOnboardingProgress, markOnboardingProgress } from '@/lib/server/onboarding-progress'
import { detectFirstWin } from '@/lib/server/activation-wins'
import { getSettings } from './workspace'
import { getSetupState } from '@/lib/shared/db-types'
import {
  isFirstWinInLaunchWindow,
  isLaunchWindowOpen,
  launchWindowFor,
} from '@/lib/shared/launch-window'
import { PERMISSIONS } from '@/lib/shared/permissions'

// The tour and the celebration belong to the team's admin pages, so only a
// team member reads or writes these markers.
export const getOnboardingProgressFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
  const row = await db.query.user.findFirst({
    where: eq(user.id, auth.user.id),
    columns: { metadata: true },
  })
  return readOnboardingProgress(row?.metadata ?? null)
})

export const markTourSeenFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
  await markOnboardingProgress(auth.user.id, 'tourSeenAt')
  return { ok: true }
})

/** Not now on the tour offer: the offer stays away for this person. */
export const dismissTourOfferFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
  await markOnboardingProgress(auth.user.id, 'tourDismissedAt')
  return { ok: true }
})

/** Show the first-win card once, and only for a win inside the launch window. */
export const claimFirstWinMomentFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
  const settings = await getSettings()
  const setupState = getSetupState(settings?.setupState ?? null)
  const window = launchWindowFor({ setupState, workspaceCreatedAt: settings?.createdAt })
  if (!isLaunchWindowOpen(window)) return { show: false }
  const win = await detectFirstWin(setupState)
  if (!win.reached || !isFirstWinInLaunchWindow(win.reachedAt, window)) return { show: false }
  return { show: await markOnboardingProgress(auth.user.id, 'firstWinShownAt') }
})
