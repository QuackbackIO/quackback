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
import type { ExternalStatusItem } from '@/lib/server/integrations/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'external-statuses' })

// NOTE: the registry is imported DYNAMICALLY inside the handler — a top-level
// import pulls the whole provider graph (db/kv/jobs) into the client
// bundle via the createServerFn stub, which import-protection rejects. The
// status-source provider set is derived from the registry in the coverage
// test, so nothing outside the handler references it here.

const fetchExternalStatusesSchema = z.object({
  integrationType: z.string(),
})

export type { ExternalStatusItem }

/**
 * Fetch available statuses from an external platform via the provider's
 * registered capability.
 */
export const fetchExternalStatusesFn = createServerFn({ method: 'POST' })
  .validator(fetchExternalStatusesSchema)
  .handler(async ({ data }): Promise<ExternalStatusItem[]> => {
    log.debug({ integration_type: data.integrationType }, 'fetch external statuses')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const { getIntegration } = await import('@/lib/server/integrations')
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
  })
