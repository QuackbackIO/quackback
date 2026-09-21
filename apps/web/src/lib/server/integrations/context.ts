import { db, integrations, eq } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { getIntegration } from './index'
import { withIntegrationReadAuth } from './token-refresh'
import type { EnrichmentCard } from './types'

/** Read-only lookups share credentials and a normalized card, not an event queue. */
export async function fetchCustomerContext(email: string): Promise<EnrichmentCard[]> {
  const active = await db.select().from(integrations).where(eq(integrations.status, 'active'))
  const cards = await Promise.all(
    active.map(async (integration) => {
      const context = getIntegration(integration.integrationType)?.context
      if (!context || !integration.secrets) return null
      try {
        return await withIntegrationReadAuth(integration.id, (auth) =>
          auth.accessToken
            ? context({ accessToken: auth.accessToken, config: auth.config, email })
            : Promise.resolve(null)
        )
      } catch (error) {
        logger.warn(
          { err: error, integration_type: integration.integrationType },
          'customer context lookup failed'
        )
        return null
      }
    })
  )
  return cards.filter((card): card is EnrichmentCard => card !== null)
}
