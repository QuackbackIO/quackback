import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { ForbiddenError } from '@/lib/shared/errors'
import { ASK_ENTITY_KINDS } from '@/lib/shared/assistant/ask-search'

export const searchWorkspaceEntitiesFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      query: z.string().trim().min(2).max(200),
      kind: z.enum(ASK_ENTITY_KINDS).optional(),
      mode: z.enum(['keyword', 'semantic']).default('keyword'),
      limit: z.number().int().min(1).max(50).default(10),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    if (auth.scope !== 'dashboard' || !['admin', 'member'].includes(auth.principal.role))
      throw new ForbiddenError('DASHBOARD_REQUIRED', 'Requires a team dashboard session')
    const { getFeatureFlags } = await import('@/lib/server/domains/settings/settings.service')
    const [actor, flags] = await Promise.all([policyActorFromAuth(auth), getFeatureFlags()])
    if (data.mode === 'semantic') {
      const { searchWorkspaceSemantically } =
        await import('@/lib/server/domains/assistant/workspace-semantic-search')
      return searchWorkspaceSemantically(data.query, actor, flags, {
        kind: data.kind,
        limit: data.limit,
        signal: AbortSignal.any([getRequest().signal, AbortSignal.timeout(1500)]),
      })
    }
    const { searchAskEntities } = await import('@/lib/server/domains/assistant/ask-search')
    return {
      available: true,
      results: await searchAskEntities(data.query, actor, flags, {
        kind: data.kind,
        limit: data.limit,
        detailed: true,
      }),
    }
  })
