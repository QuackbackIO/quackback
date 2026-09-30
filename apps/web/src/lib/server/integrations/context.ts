import { db, integrations, eq, sql } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { getIntegration } from './index'
import { withIntegrationReadAuth } from './token-refresh'
import type { EnrichmentCard } from './types'

/** Active integrations that can answer a lookup: the `context` capability plus credentials. */
async function contextProviders() {
  const active = await db.select().from(integrations).where(eq(integrations.status, 'active'))
  return active.flatMap((integration) => {
    const context = getIntegration(integration.integrationType)?.context
    return context && integration.secrets ? [{ integration, context }] : []
  })
}

/** Whether any connected integration could answer a lookup, without calling out to it. */
export async function hasCustomerContextProvider(): Promise<boolean> {
  // The same test as contextProviders, reading two columns rather than whole rows.
  const active = await db
    .select({
      integrationType: integrations.integrationType,
      hasSecrets: sql<boolean>`coalesce(${integrations.secrets}, '') <> ''`,
    })
    .from(integrations)
    .where(eq(integrations.status, 'active'))
  return active.some(
    (integration) =>
      integration.hasSecrets && !!getIntegration(integration.integrationType)?.context
  )
}

/** Read-only lookups share credentials and a normalized card, not an event queue. */
export async function fetchCustomerContext(email: string): Promise<EnrichmentCard[]> {
  const providers = await contextProviders()
  const cards = await Promise.all(
    providers.map(async ({ integration, context }) => {
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
