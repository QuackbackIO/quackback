import { createServerFn } from '@tanstack/react-start'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { getWorkspaceSettings } from '@/lib/server/domains/settings/settings.service'
import { getAdminOverview } from '@/lib/server/domains/admin-overview/admin-overview.query'

export const fetchAdminOverviewFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth()
  const actor = await policyActorFromAuth(auth)
  const settings = await getWorkspaceSettings()
  return getAdminOverview({ actor, flags: settings?.featureFlags })
})
