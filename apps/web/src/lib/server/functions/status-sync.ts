/**
 * Server functions for managing inbound webhook (status sync) configuration.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { db, integrations, eq } from '@/lib/server/db'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import {
  generateWebhookSecret,
  buildWebhookCallbackUrl,
  storeWebhookConfig,
  clearWebhookConfig,
} from '@/lib/server/integrations/webhook-registration'
import type { IntegrationId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'status-sync' })

// NOTE: the registry (`@/lib/server/integrations`) is imported DYNAMICALLY
// inside the handlers below — a top-level import would pull the whole
// provider graph (and its db/kv/jobs packages) into the client bundle
// via the createServerFn client stub, which import-protection rejects. The
// webhook-setup split is derived from the registry directly in the coverage
// test, so nothing outside a handler references it here.

const enableStatusSyncSchema = z.object({
  integrationId: z.string(),
  integrationType: z.string(),
})

const disableStatusSyncSchema = z.object({
  integrationId: z.string(),
  integrationType: z.string(),
})

const updateStatusMappingsSchema = z.object({
  integrationId: z.string(),
  statusMappings: z.record(z.string(), z.string().nullable()),
})

const updateTicketStatusMappingsSchema = z.object({
  integrationId: z.string(),
  ticketStatusMappings: z.record(z.string(), z.string().nullable()),
})

// Outbound (IF WO-15): Quackback statusId -> remote status name to push. Keyed
// by Quackback status id (stable) rather than name; unmapped statuses (value
// omitted) simply don't push.
const updatePushStatusMappingsSchema = z.object({
  integrationId: z.string(),
  /** posts: `pushStatusMappings`; tickets: `ticketPushStatusMappings`. */
  target: z.enum(['post', 'ticket']),
  pushStatusMappings: z.record(z.string(), z.string()),
})

/**
 * Enable status sync by registering an inbound webhook with the external platform.
 */
export const enableStatusSyncFn = createServerFn({ method: 'POST' })
  .validator(enableStatusSyncSchema)
  .handler(async ({ data }) => {
    log.debug(
      { integration_id: data.integrationId, integration_type: data.integrationType },
      'enable status sync'
    )
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integrationId = data.integrationId as IntegrationId
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId),
    })

    if (!integration) throw new Error('Integration not found')
    if (integration.status !== 'active') throw new Error('Integration must be active')

    const secret = generateWebhookSecret()
    const callbackUrl = buildWebhookCallbackUrl(data.integrationType)
    const config = (integration.config ?? {}) as Record<string, unknown>

    let externalWebhookId: string | undefined

    // Decrypt secrets for API calls
    let accessToken: string | undefined
    if (integration.secrets) {
      const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
      accessToken = secrets.accessToken
    }

    // Auto-register webhook for platforms whose definition provides a
    // registration capability; 'manual' providers skip (the UI shows the
    // callback URL instead).
    if (accessToken) {
      try {
        const { getIntegration } = await import('@/lib/server/integrations')
        const registration = getIntegration(data.integrationType)?.webhookRegistration
        if (registration && registration !== 'manual') {
          const result = await registration.register({
            accessToken,
            config,
            callbackUrl,
            secret,
          })
          externalWebhookId = result.externalWebhookId
        }
      } catch (error) {
        log.error(
          { err: error, integration_type: data.integrationType },
          'webhook registration failed'
        )
        const { recordIntegrationLastError } =
          await import('@/lib/server/integrations/webhook-registration')
        const raw = error instanceof Error ? error.message : 'Unknown error'
        await recordIntegrationLastError(integrationId, `Failed to register webhook: ${raw}`).catch(
          () => {}
        )
        // Providers reject a second webhook at the same callback URL (Linear:
        // "url not unique"; GitHub: "Hook already exists"). This means a prior
        // status-sync webhook was left registered — surface an actionable
        // message instead of the raw provider text.
        const isDuplicate = /not unique|already exists|already registered|duplicate/i.test(raw)
        throw new Error(
          isDuplicate
            ? 'A status-sync webhook is already registered with this provider for this workspace. ' +
                'Turn status sync off, then on again to replace it — or remove the existing webhook in the provider first.'
            : `Failed to register webhook: ${raw}`,
          { cause: error }
        )
      }
    }

    await storeWebhookConfig(integrationId, secret, externalWebhookId)

    return {
      success: true,
      callbackUrl,
      // For manual platforms, return the URL so the UI can display it
      isManual: !externalWebhookId && !accessToken,
    }
  })

/**
 * Disable status sync by removing the webhook from the external platform.
 */
export const disableStatusSyncFn = createServerFn({ method: 'POST' })
  .validator(disableStatusSyncSchema)
  .handler(async ({ data }) => {
    log.debug(
      { integration_id: data.integrationId, integration_type: data.integrationType },
      'disable status sync'
    )
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integrationId = data.integrationId as IntegrationId
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId),
    })

    if (!integration) throw new Error('Integration not found')

    const config = (integration.config ?? {}) as Record<string, unknown>
    const externalWebhookId = config.externalWebhookId as string | undefined

    // Clean up external webhook if one was registered
    if (externalWebhookId && integration.secrets) {
      try {
        const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
        if (secrets.accessToken) {
          const { getIntegration } = await import('@/lib/server/integrations')
          const registration = getIntegration(data.integrationType)?.webhookRegistration
          if (registration && registration !== 'manual') {
            await registration.unregister({
              accessToken: secrets.accessToken,
              config,
              externalWebhookId,
            })
          }
        }
      } catch (error) {
        log.error({ err: error, integration_type: data.integrationType }, 'webhook deletion failed')
        // Continue with cleanup even if external deletion fails
      }
    }

    await clearWebhookConfig(integrationId)
    return { success: true }
  })

/**
 * Update status mappings for an integration.
 */
export const updateStatusMappingsFn = createServerFn({ method: 'POST' })
  .validator(updateStatusMappingsSchema)
  .handler(async ({ data }) => {
    log.debug(
      {
        integration_id: data.integrationId,
        mapping_count: Object.keys(data.statusMappings).length,
      },
      'update status mappings'
    )
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integrationId = data.integrationId as IntegrationId
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId),
      columns: { config: true },
    })

    if (!integration) throw new Error('Integration not found')

    const existingConfig = (integration.config ?? {}) as Record<string, unknown>
    await db
      .update(integrations)
      .set({
        config: { ...existingConfig, statusMappings: data.statusMappings },
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId))

    return { success: true }
  })

/**
 * Update ticket status mappings for an integration — the ticket-side sibling
 * of updateStatusMappingsFn (external status name -> ticket_statuses id),
 * consumed by the inbound webhook handler's ticket branch.
 */
export const updateTicketStatusMappingsFn = createServerFn({ method: 'POST' })
  .validator(updateTicketStatusMappingsSchema)
  .handler(async ({ data }) => {
    log.debug(
      {
        integration_id: data.integrationId,
        mapping_count: Object.keys(data.ticketStatusMappings).length,
      },
      'update ticket status mappings'
    )
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integrationId = data.integrationId as IntegrationId
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId),
      columns: { config: true },
    })

    if (!integration) throw new Error('Integration not found')

    const existingConfig = (integration.config ?? {}) as Record<string, unknown>
    await db
      .update(integrations)
      .set({
        config: { ...existingConfig, ticketStatusMappings: data.ticketStatusMappings },
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId))

    return { success: true }
  })

/**
 * Update the OUTBOUND push mappings for an integration (IF WO-15, two-way
 * status sync). Stores the per-Quackback-status → remote-status map under
 * `pushStatusMappings` (posts) or `ticketPushStatusMappings` (tickets); the
 * remote-status-push resolver reads it when an entity status changes.
 */
export const updatePushStatusMappingsFn = createServerFn({ method: 'POST' })
  .validator(updatePushStatusMappingsSchema)
  .handler(async ({ data }) => {
    log.debug(
      { integration_id: data.integrationId, target: data.target },
      'update push status mappings'
    )
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integrationId = data.integrationId as IntegrationId
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId),
      columns: { config: true },
    })
    if (!integration) throw new Error('Integration not found')

    const key = data.target === 'ticket' ? 'ticketPushStatusMappings' : 'pushStatusMappings'
    const existingConfig = (integration.config ?? {}) as Record<string, unknown>
    await db
      .update(integrations)
      .set({
        config: { ...existingConfig, [key]: data.pushStatusMappings },
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId))

    return { success: true }
  })
