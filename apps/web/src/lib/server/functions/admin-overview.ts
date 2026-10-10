import { createServerFn } from '@tanstack/react-start'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import {
  getWorkspaceSettings,
  getWorkspaceSettingsRow,
} from '@/lib/server/domains/settings/settings.service'
import { getAdminOverview } from '@/lib/server/domains/admin-overview/admin-overview.query'
import { getSetupState } from '@/lib/shared/db-types'
import { isLaunchWindowOpen, launchWindowFor } from '@/lib/shared/launch-window'

export const fetchAdminOverviewFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth()
  const actor = await policyActorFromAuth(auth)
  const [settings, row] = await Promise.all([getWorkspaceSettings(), getWorkspaceSettingsRow()])
  // Home stays quiet only for a new workspace; asking costs queries on every load.
  const probeRealData = isLaunchWindowOpen(
    launchWindowFor({
      setupState: getSetupState(row?.setupState ?? null),
      workspaceCreatedAt: row?.createdAt,
    })
  )
  return getAdminOverview({ actor, flags: settings?.featureFlags, probeRealData })
})
