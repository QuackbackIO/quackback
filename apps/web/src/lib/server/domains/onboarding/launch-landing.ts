/**
 * Whether a workspace's launch plan is still open: inside its launch window
 * and before the first real win. While it is, the team's way back in lands on
 * the admin, where the plan is, instead of the public portal.
 */
import { db, settings } from '@/lib/server/db'
import { getSetupState } from '@/lib/shared/db-types'
import { isLaunchWindowOpen, launchWindowFor } from '@/lib/shared/launch-window'
import { detectFirstWin } from '@/lib/server/activation-wins'

export async function isLaunchPlanOpen(): Promise<boolean> {
  const [row] = await db
    .select({ setupState: settings.setupState, createdAt: settings.createdAt })
    .from(settings)
    .limit(1)
  if (!row) return false
  const setupState = getSetupState(row.setupState ?? null)
  if (!isLaunchWindowOpen(launchWindowFor({ setupState, workspaceCreatedAt: row.createdAt }))) {
    return false
  }
  return !(await detectFirstWin(setupState)).reached
}
