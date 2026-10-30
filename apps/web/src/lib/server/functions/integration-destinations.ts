/**
 * Server functions for an integration's routing destinations — the target
 * container a created issue/task/card lands in (Trello lists, Jira projects,
 * GitHub repos, Linear teams, ...). `fetchIntegrationDestinationsFn` lists
 * what the provider offers via its `destinations[kind]` capability
 * (`parentId` scopes a dependent kind, e.g. Trello list within a board). The
 * others read and repair the destinations a connection already serves
 * (`integration_destinations`, for providers with `destination.multiple`).
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { db, integrations, integrationDestinations, eq } from '@/lib/server/db'
import type { IntegrationDestinationId } from '@quackback/ids'
import type { DestinationItem } from '@/lib/server/integrations/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
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

const listConnectedDestinationsSchema = z.object({ integrationType: z.string() })

const reconnectDestinationSchema = z.object({ destinationId: z.string() })

export type { DestinationItem }

/** One destination a connection serves, as the settings page shows it. Never carries its secret. */
export interface IntegrationDestinationSummary {
  id: string
  kind: string
  externalId: string
  enabled: boolean
  webhookRegistered: boolean
  webhookEvents: string[]
  lastError: string | null
  lastErrorAt: string | null
  lastInboundAt: string | null
}

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
    const { withIntegrationReadAuth } = await import('@/lib/server/integrations/token-refresh')
    return withIntegrationReadAuth(integration.id, async ({ accessToken, config }) =>
      accessToken ? destination.list({ accessToken, config, parentId: data.parentId }) : []
    )
  })

/**
 * The destinations a connection serves, with each one's webhook health.
 * Empty when the integration is not connected.
 */
export const listIntegrationDestinationsFn = createServerFn({ method: 'GET' })
  .validator(listConnectedDestinationsSchema)
  .handler(async ({ data }): Promise<IntegrationDestinationSummary[]> => {
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_VIEW })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, data.integrationType),
      columns: { id: true },
    })
    if (!integration) return []

    const { listDestinations } = await import('@/lib/server/integrations/destinations')
    return (await listDestinations(integration.id)).map((destination) => ({
      id: destination.id,
      kind: destination.kind,
      externalId: destination.externalId,
      enabled: destination.enabled,
      webhookRegistered: !!destination.externalWebhookId,
      webhookEvents: destination.webhookEvents ?? [],
      lastError: destination.lastError,
      lastErrorAt: destination.lastErrorAt?.toISOString() ?? null,
      lastInboundAt: destination.lastInboundAt?.toISOString() ?? null,
    }))
  })

/**
 * Repair one destination's webhook: register it again (the provider patches
 * a hook it already has at our URL), keeping the destination's secret, and
 * clear its recorded error. A failure is recorded on the destination and
 * returned to the caller.
 */
export const reconnectIntegrationDestinationFn = createServerFn({ method: 'POST' })
  .validator(reconnectDestinationSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    log.debug({ destination_id: data.destinationId }, 'reconnect integration destination')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const destination = await db.query.integrationDestinations.findFirst({
      where: eq(integrationDestinations.id, data.destinationId as IntegrationDestinationId),
    })
    if (!destination) throw new NotFoundError('DESTINATION_NOT_FOUND', 'Destination not found')
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, destination.integrationId),
    })
    if (integration?.status !== 'active')
      throw new ValidationError('INTEGRATION_UNAVAILABLE', 'Connect the integration first')

    const { getIntegrationAuth } = await import('@/lib/server/integrations/token-refresh')
    const { accessToken } = await getIntegrationAuth(integration.id)
    if (!accessToken)
      throw new ValidationError(
        'INTEGRATION_UNAVAILABLE',
        'Reconnect the integration before repairing its webhook'
      )

    const { registerDestinationWebhook, clearDestinationError, recordDestinationError } =
      await import('@/lib/server/integrations/destinations')
    try {
      await registerDestinationWebhook({ integration, destination, accessToken })
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      log.error({ err: error, destination_id: destination.id }, 'webhook repair failed')
      await recordDestinationError(destination.id, `Failed to register webhook: ${raw}`).catch(
        () => {}
      )
      throw new Error(`Failed to register webhook: ${raw}`, { cause: error })
    }
    await clearDestinationError(destination.id)
    return { ok: true }
  })
