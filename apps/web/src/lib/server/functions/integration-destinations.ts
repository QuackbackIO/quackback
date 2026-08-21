/**
 * Server function for fetching an integration's routing destinations — the
 * target container a created issue/task/card lands in (Trello lists, Jira
 * projects, GitHub repos, Linear teams, ...). Dispatches via each provider's
 * registered `destinations[kind]` capability. `parentId` scopes a dependent
 * kind (e.g. Trello list within a board).
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { IntegrationId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { db, integrations, eq } from '@/lib/server/db'
import type { DestinationItem } from '@/lib/server/integrations/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'integration-destinations' })

// NOTE: the registry is imported DYNAMICALLY inside the handler — a top-level
// import pulls the whole provider graph (db/kv/jobs) into the client
// bundle via the createServerFn stub, which import-protection rejects.

const fetchDestinationsSchema = z.object({
  integrationType: z.string(),
  kind: z.string(),
  parentId: z.string().optional(),
})

export type { DestinationItem }

/**
 * Fetch selectable destinations of a given `kind` from a connected
 * integration. Returns `[]` for an unsupported kind or an inactive/missing
 * integration.
 */
export const fetchIntegrationDestinationsFn = createServerFn({ method: 'POST' })
  .validator(fetchDestinationsSchema)
  .handler(async ({ data }): Promise<DestinationItem[]> => {
    log.debug(
      { integration_type: data.integrationType, kind: data.kind, parent_id: data.parentId },
      'fetch integration destinations'
    )
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const { getIntegration } = await import('@/lib/server/integrations')
    const destination = getIntegration(data.integrationType)?.destinations?.[data.kind]
    if (!destination) return []

    // A dependent kind can't be listed until its parent is chosen.
    if (destination.childOf && !data.parentId) return []

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, data.integrationType),
    })
    if (!integration?.secrets || integration.status !== 'active') return []

    // Centralized token refresh (IF WO-13) so slot `list` closures stay thin.
    const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
    const accessToken = await getValidAccessToken(integration.id as IntegrationId)
    if (!accessToken) return []

    const config = (integration.config ?? {}) as Record<string, unknown>
    return destination.list({ accessToken, config, parentId: data.parentId })
  })
