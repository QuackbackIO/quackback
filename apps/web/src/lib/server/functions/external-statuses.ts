/**
 * Server function for fetching external statuses from integration platforms.
 * Used by the status mapping UI to show available statuses for mapping.
 * Dispatches via each provider's registered `listExternalStatuses` capability.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { db, integrations, eq } from '@/lib/server/db'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import { getIntegration, listIntegrationTypes } from '@/lib/server/integrations'
import type { ExternalStatusItem } from '@/lib/server/integrations/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'external-statuses' })

const fetchExternalStatusesSchema = z.object({
  integrationType: z.string(),
})

export type { ExternalStatusItem }

/**
 * Providers with a status source, DERIVED from each provider's registered
 * `listExternalStatuses` capability. Kept as an export for the
 * registry-capability-coverage suite; the registry is the source of truth —
 * an inbound provider without the capability fails CI there, not silently.
 */
export const EXTERNAL_STATUS_PROVIDERS: ReadonlySet<string> = new Set(
  listIntegrationTypes().filter((t) => getIntegration(t)?.listExternalStatuses)
)

/**
 * Fetch available statuses from an external platform via the provider's
 * registered capability.
 */
export const fetchExternalStatusesFn = createServerFn({ method: 'POST' })
  .validator(fetchExternalStatusesSchema)
  .handler(async ({ data }): Promise<ExternalStatusItem[]> => {
    log.debug({ integration_type: data.integrationType }, 'fetch external statuses')
    try {
      await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

      const listExternalStatuses = getIntegration(data.integrationType)?.listExternalStatuses
      if (!listExternalStatuses) return []

      const integration = await db.query.integrations.findFirst({
        where: eq(integrations.integrationType, data.integrationType),
      })
      if (!integration?.secrets || integration.status !== 'active') {
        return []
      }

      const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
      if (!secrets.accessToken) return []

      const config = (integration.config ?? {}) as Record<string, unknown>

      return listExternalStatuses({ accessToken: secrets.accessToken, config })
    } catch (error) {
      log.error({ err: error }, 'fetch external statuses failed')
      throw error
    }
  })
