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

/**
 * Providers the enable/disable switches below auto-register webhooks for.
 * These switch statements sit OUTSIDE the IntegrationDefinition registry, and
 * a provider missing a case silently no-ops — so the split is declared here
 * and pinned against the registry by registry-capability-coverage.test.ts:
 * every inbound-capable tracker must appear in exactly one of these sets, and
 * adding provider #12 without deciding its webhook-setup story fails CI
 * instead of silently doing nothing.
 */
export const AUTO_WEBHOOK_REGISTRATION_PROVIDERS: ReadonlySet<string> = new Set([
  'linear',
  'github',
  'jira',
  'clickup',
  'asana',
])
/** Inbound-capable providers whose webhook must be configured by hand on the
 *  external platform (no registration API used; the UI shows the callback URL). */
export const MANUAL_WEBHOOK_PROVIDERS: ReadonlySet<string> = new Set([
  'azure_devops',
  'gitlab',
  'shortcut',
  'trello',
])

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
    try {
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

      // Auto-register webhook for platforms that support it
      if (accessToken) {
        try {
          switch (data.integrationType) {
            case 'linear': {
              const { registerLinearWebhook } =
                await import('@/lib/server/integrations/linear/webhook-registration')
              const teamId = config.channelId as string | undefined
              const result = await registerLinearWebhook(accessToken, callbackUrl, secret, teamId)
              externalWebhookId = result.webhookId
              break
            }
            case 'github': {
              const { registerGitHubWebhook } =
                await import('@/lib/server/integrations/github/webhook-registration')
              const ownerRepo = config.channelId as string
              if (!ownerRepo) throw new Error('No repository configured')
              const result = await registerGitHubWebhook(
                accessToken,
                ownerRepo,
                callbackUrl,
                secret
              )
              externalWebhookId = result.webhookId
              break
            }
            case 'jira': {
              const { registerJiraWebhook } =
                await import('@/lib/server/integrations/jira/webhook-registration')
              const cloudId = config.cloudId as string
              if (!cloudId) throw new Error('No Jira Cloud ID configured')
              const result = await registerJiraWebhook(accessToken, cloudId, callbackUrl, secret)
              externalWebhookId = result.webhookId
              break
            }
            case 'clickup': {
              const { registerClickUpWebhook } =
                await import('@/lib/server/integrations/clickup/webhook-registration')
              const teamId = config.teamId as string
              if (!teamId) throw new Error('No ClickUp team configured')
              const result = await registerClickUpWebhook(accessToken, teamId, callbackUrl, secret)
              externalWebhookId = result.webhookId
              break
            }
            case 'asana': {
              const { registerAsanaWebhook } =
                await import('@/lib/server/integrations/asana/webhook-registration')
              const projectGid = config.channelId as string
              if (!projectGid) throw new Error('No Asana project configured')
              const result = await registerAsanaWebhook(accessToken, projectGid, callbackUrl)
              externalWebhookId = result.webhookId
              break
            }
            // shortcut, azure_devops: manual webhook setup — no auto-registration
          }
        } catch (error) {
          log.error(
            { err: error, integration_type: data.integrationType },
            'webhook registration failed'
          )
          throw new Error(
            `Failed to register webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
    } catch (error) {
      log.error({ err: error }, 'enable status sync failed')
      throw error
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
    try {
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
            switch (data.integrationType) {
              case 'linear': {
                const { deleteLinearWebhook } =
                  await import('@/lib/server/integrations/linear/webhook-registration')
                await deleteLinearWebhook(secrets.accessToken, externalWebhookId)
                break
              }
              case 'github': {
                const { deleteGitHubWebhook } =
                  await import('@/lib/server/integrations/github/webhook-registration')
                const ownerRepo = config.channelId as string
                if (ownerRepo) {
                  await deleteGitHubWebhook(secrets.accessToken, ownerRepo, externalWebhookId)
                }
                break
              }
              case 'jira': {
                const { deleteJiraWebhook } =
                  await import('@/lib/server/integrations/jira/webhook-registration')
                const cloudId = config.cloudId as string
                if (cloudId) {
                  await deleteJiraWebhook(secrets.accessToken, cloudId, externalWebhookId)
                }
                break
              }
              case 'clickup': {
                const { deleteClickUpWebhook } =
                  await import('@/lib/server/integrations/clickup/webhook-registration')
                await deleteClickUpWebhook(secrets.accessToken, externalWebhookId)
                break
              }
              case 'asana': {
                const { deleteAsanaWebhook } =
                  await import('@/lib/server/integrations/asana/webhook-registration')
                await deleteAsanaWebhook(secrets.accessToken, externalWebhookId)
                break
              }
            }
          }
        } catch (error) {
          log.error(
            { err: error, integration_type: data.integrationType },
            'webhook deletion failed'
          )
          // Continue with cleanup even if external deletion fails
        }
      }

      await clearWebhookConfig(integrationId)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'disable status sync failed')
      throw error
    }
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
    try {
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
    } catch (error) {
      log.error({ err: error }, 'update status mappings failed')
      throw error
    }
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
    try {
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
    } catch (error) {
      log.error({ err: error }, 'update ticket status mappings failed')
      throw error
    }
  })
