/**
 * Server function for searching an integration's existing remote items by title
 * (IF WO-15) — powers "link an existing issue" by typing a title instead of
 * pasting a URL. Dispatches via each provider's `externalLinks.search`
 * capability; returns `[]` where the provider doesn't implement search (the UI
 * degrades to paste-a-URL).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { IntegrationId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { db, integrations, eq } from '@/lib/server/db'
import type { RemoteItemMatch } from '@/lib/server/integrations/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'external-item-search' })

const searchSchema = z.object({
  integrationType: z.string(),
  query: z.string().min(1),
})

export type { RemoteItemMatch }

export const searchExternalItemsFn = createServerFn({ method: 'POST' })
  .validator(searchSchema)
  .handler(async ({ data }): Promise<RemoteItemMatch[]> => {
    log.debug({ integration_type: data.integrationType }, 'search external items')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const { getIntegration } = await import('@/lib/server/integrations')
    const search = getIntegration(data.integrationType)?.externalLinks?.search
    if (!search) return []

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, data.integrationType),
    })
    if (!integration?.secrets || integration.status !== 'active') return []

    const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
    const accessToken = await getValidAccessToken(integration.id as IntegrationId)
    if (!accessToken) return []

    const config = (integration.config ?? {}) as Record<string, unknown>
    return search({ accessToken, config, query: data.query })
  })
