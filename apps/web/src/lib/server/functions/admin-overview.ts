import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { getWorkspaceSettings } from '@/lib/server/domains/settings/settings.service'
import { getAdminOverview } from '@/lib/server/domains/admin-overview/admin-overview.query'

const schema = z.object({
  scope: z.enum(['team', 'mine']).default('team'),
})

export const fetchAdminOverviewFn = createServerFn({ method: 'GET' })
  .validator(schema)
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    const actor = await policyActorFromAuth(auth)
    const settings = await getWorkspaceSettings()
    return getAdminOverview({
      scope: data.scope,
      actor,
      flags: settings?.featureFlags,
    })
  })
