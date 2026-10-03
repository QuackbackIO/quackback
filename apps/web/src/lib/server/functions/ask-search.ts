import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth, policyActorFromAuth } from './auth-helpers'

export const searchAskEntitiesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ query: z.string().max(200) }))
  .handler(async ({ data }) => {
    const { searchAskEntities } = await import('@/lib/server/domains/assistant/ask-search')
    const { getFeatureFlags } = await import('@/lib/server/domains/settings/settings.service')
    const auth = await requireAuth()
    if (
      auth.scope !== 'dashboard' ||
      (auth.principal.role !== 'admin' && auth.principal.role !== 'member')
    ) {
      throw new Error('Access denied: Requires a team dashboard session')
    }
    return searchAskEntities(data.query, await policyActorFromAuth(auth), await getFeatureFlags())
  })
