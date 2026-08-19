/**
 * Customer-context enrichment (IF WO-9). Fetches normalized context cards from
 * every connected integration that provides a `context` capability
 * (zendesk/hubspot/intercom today), looked up by email on demand. Providers
 * that error or don't match are simply omitted.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { db, integrations, eq } from '@/lib/server/db'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import type { EnrichmentCard } from '@/lib/server/integrations/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'customer-context' })

const schema = z.object({ email: z.string().email() })

export type { EnrichmentCard }

export const fetchCustomerContextFn = createServerFn({ method: 'POST' })
  .validator(schema)
  .handler(async ({ data }): Promise<EnrichmentCard[]> => {
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_VIEW })

    // Dynamic registry import keeps the provider graph out of the client
    // bundle (same rule as the other server-fn bridges).
    const { getIntegration, listIntegrationTypes } = await import('@/lib/server/integrations')
    const providers = listIntegrationTypes().filter((t) => getIntegration(t)?.context)
    if (providers.length === 0) return []

    const active = await db
      .select({
        type: integrations.integrationType,
        secrets: integrations.secrets,
        config: integrations.config,
      })
      .from(integrations)
      .where(eq(integrations.status, 'active'))

    const cards = await Promise.all(
      active
        .filter((row) => providers.includes(row.type) && row.secrets)
        .map(async (row) => {
          try {
            const context = getIntegration(row.type)!.context!
            const secrets = decryptSecrets<{ accessToken?: string }>(row.secrets!)
            if (!secrets.accessToken) return null
            return await context({
              accessToken: secrets.accessToken,
              config: (row.config ?? {}) as Record<string, unknown>,
              email: data.email,
            })
          } catch (error) {
            log.warn({ err: error, integration_type: row.type }, 'customer context lookup failed')
            return null
          }
        })
    )

    return cards.filter((c): c is EnrichmentCard => c !== null)
  })
