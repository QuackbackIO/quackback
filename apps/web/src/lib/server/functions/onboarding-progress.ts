import { createServerFn } from '@tanstack/react-start'
import { eq, db, user } from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { readOnboardingProgress, markOnboardingProgress } from '@/lib/server/onboarding-progress'
import { detectFirstWin } from '@/lib/server/activation-wins'
import { getSettings } from './workspace'
import { getSetupState } from '@/lib/shared/db-types'

export const getOnboardingProgressFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth()
  const row = await db.query.user.findFirst({
    where: eq(user.id, auth.user.id),
    columns: { metadata: true },
  })
  return readOnboardingProgress(row?.metadata ?? null)
})

export const markTourSeenFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth()
  await markOnboardingProgress(auth.user.id, 'tourSeenAt')
  return { ok: true }
})

export const claimFirstWinMomentFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth()
  const settings = await getSettings()
  const win = await detectFirstWin(getSetupState(settings?.setupState ?? null))
  return { show: win.reached && (await markOnboardingProgress(auth.user.id, 'firstWinShownAt')) }
})
