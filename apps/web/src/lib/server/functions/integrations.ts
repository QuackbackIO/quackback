import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { db, integrations, integrationEventMappings, eq, and, sql } from '@/lib/server/db'
import type { IntegrationId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
// cacheDel/CACHE_KEYS are imported dynamically inside handlers to keep ioredis out of the client bundle

const log = logger.child({ component: 'integrations' })

// ============================================
// Schemas
// ============================================

const updateIntegrationSchema = z.object({
  id: z.string(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  eventMappings: z
    .array(
      z.object({
        eventType: z.string(),
        enabled: z.boolean(),
      })
    )
    .optional(),
})

const deleteIntegrationSchema = z.object({
  id: z.string(),
})

export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>
export type DeleteIntegrationInput = z.infer<typeof deleteIntegrationSchema>

// ============================================
// Mutations
// ============================================

/**
 * Update integration config and event mappings
 */
export const updateIntegrationFn = createServerFn({ method: 'POST' })
  .validator(updateIntegrationSchema)
  .handler(async ({ data }) => {
    log.debug({ integration_id: data.id }, 'update integration')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integrationId = data.id as IntegrationId

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId),
    })

    if (!integration) {
      throw new Error('Integration not found')
    }

    const updates: Partial<typeof integrations.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (data.enabled !== undefined) {
      updates.status = data.enabled ? 'active' : 'paused'
    }

    if (data.config) {
      const existingConfig = (integration.config as Record<string, unknown>) || {}
      updates.config = { ...existingConfig, ...data.config }
    }

    await db.update(integrations).set(updates).where(eq(integrations.id, integrationId))

    // Batch upsert all event mappings in a single query
    if (data.eventMappings && data.eventMappings.length > 0) {
      await db
        .insert(integrationEventMappings)
        .values(
          data.eventMappings.map((mapping) => ({
            integrationId,
            eventType: mapping.eventType,
            actionType: 'send_message' as const,
            enabled: mapping.enabled,
          }))
        )
        .onConflictDoUpdate({
          target: [
            integrationEventMappings.integrationId,
            integrationEventMappings.eventType,
            integrationEventMappings.actionType,
            integrationEventMappings.targetKey,
          ],
          set: {
            enabled: sql`excluded.enabled`,
            updatedAt: new Date(),
          },
        })
    }

    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
    log.info({ integration_id: data.id }, 'integration updated')
    return { success: true }
  })

/**
 * Delete an integration
 */
export const deleteIntegrationFn = createServerFn({ method: 'POST' })
  .validator(deleteIntegrationSchema)
  .handler(async ({ data }) => {
    log.debug({ integration_id: data.id }, 'delete integration')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integrationId = data.id as IntegrationId

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId),
    })

    if (!integration) {
      throw new Error('Integration not found')
    }

    // Revoke tokens with the provider before deleting (dynamic import to avoid bundling @slack/web-api client-side)
    if (integration.secrets) {
      try {
        const { getIntegration } = await import('@/lib/server/integrations')
        const { decryptSecrets } = await import('@/lib/server/integrations/encryption')
        const { getPlatformCredentials } =
          await import('@/lib/server/domains/platform-credentials/platform-credential.service')
        const definition = getIntegration(integration.integrationType)
        if (definition?.onDisconnect) {
          const secrets = decryptSecrets(integration.secrets)
          const credentials =
            (await getPlatformCredentials(integration.integrationType)) ?? undefined
          await definition.onDisconnect(
            secrets,
            (integration.config ?? {}) as Record<string, unknown>,
            credentials
          )
        }
      } catch (err) {
        log.error({ err, integration_type: integration.integrationType }, 'onDisconnect failed')
        // Continue with deletion even if revocation fails
      }
    }

    await db.delete(integrations).where(eq(integrations.id, integrationId))

    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
    log.info({ integration_id: data.id }, 'integration deleted')
    return { id: data.id }
  })

// ============================================
// Notification Channel CRUD
// ============================================

const addNotificationChannelSchema = z.object({
  integrationId: z.string(),
  channelId: z.string(),
  events: z.array(z.string()),
  boardIds: z.array(z.string()).optional(),
})

const updateNotificationChannelSchema = z.object({
  integrationId: z.string(),
  channelId: z.string(),
  events: z.array(
    z.object({
      eventType: z.string(),
      enabled: z.boolean(),
    })
  ),
  boardIds: z.array(z.string()).nullable().optional(),
})

const removeNotificationChannelSchema = z.object({
  integrationId: z.string(),
  channelId: z.string(),
})

export type AddNotificationChannelInput = z.infer<typeof addNotificationChannelSchema>
export type UpdateNotificationChannelInput = z.infer<typeof updateNotificationChannelSchema>
export type RemoveNotificationChannelInput = z.infer<typeof removeNotificationChannelSchema>

/**
 * Add a notification channel with event mappings
 */
export const addNotificationChannelFn = createServerFn({ method: 'POST' })
  .validator(addNotificationChannelSchema)
  .handler(async ({ data }) => {
    log.debug({ channel_id: data.channelId }, 'add notification channel')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integrationId = data.integrationId as IntegrationId
    const filters = data.boardIds?.length ? { boardIds: data.boardIds } : null

    await db
      .insert(integrationEventMappings)
      .values(
        data.events.map((eventType) => ({
          integrationId,
          eventType,
          actionType: 'send_message' as const,
          targetKey: data.channelId,
          actionConfig: { channelId: data.channelId },
          filters,
          enabled: true,
        }))
      )
      .onConflictDoUpdate({
        target: [
          integrationEventMappings.integrationId,
          integrationEventMappings.eventType,
          integrationEventMappings.actionType,
          integrationEventMappings.targetKey,
        ],
        set: {
          enabled: sql`excluded.enabled`,
          actionConfig: sql`excluded.action_config`,
          filters: sql`excluded.filters`,
          updatedAt: new Date(),
        },
      })

    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
    log.info(
      { channel_id: data.channelId, event_count: data.events.length },
      'notification channel added'
    )
    return { success: true }
  })

/**
 * Update a notification channel's event mappings and board filter
 */
export const updateNotificationChannelFn = createServerFn({ method: 'POST' })
  .validator(updateNotificationChannelSchema)
  .handler(async ({ data }) => {
    log.debug({ channel_id: data.channelId }, 'update notification channel')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integrationId = data.integrationId as IntegrationId
    const filters = data.boardIds?.length ? { boardIds: data.boardIds } : null

    // Upsert event mappings for this channel
    await db
      .insert(integrationEventMappings)
      .values(
        data.events.map((event) => ({
          integrationId,
          eventType: event.eventType,
          actionType: 'send_message' as const,
          targetKey: data.channelId,
          actionConfig: { channelId: data.channelId },
          filters,
          enabled: event.enabled,
        }))
      )
      .onConflictDoUpdate({
        target: [
          integrationEventMappings.integrationId,
          integrationEventMappings.eventType,
          integrationEventMappings.actionType,
          integrationEventMappings.targetKey,
        ],
        set: {
          enabled: sql`excluded.enabled`,
          filters: sql`excluded.filters`,
          updatedAt: new Date(),
        },
      })

    // Also update filters on any existing mappings for this channel that weren't in the upsert
    await db
      .update(integrationEventMappings)
      .set({ filters, updatedAt: new Date() })
      .where(
        and(
          eq(integrationEventMappings.integrationId, integrationId),
          eq(integrationEventMappings.targetKey, data.channelId)
        )
      )

    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
    log.info({ channel_id: data.channelId }, 'notification channel updated')
    return { success: true }
  })

/**
 * Remove a notification channel and all its event mappings
 */
export const removeNotificationChannelFn = createServerFn({ method: 'POST' })
  .validator(removeNotificationChannelSchema)
  .handler(async ({ data }) => {
    log.debug({ channel_id: data.channelId }, 'remove notification channel')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integrationId = data.integrationId as IntegrationId

    await db
      .delete(integrationEventMappings)
      .where(
        and(
          eq(integrationEventMappings.integrationId, integrationId),
          eq(integrationEventMappings.targetKey, data.channelId)
        )
      )

    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
    log.info({ channel_id: data.channelId }, 'notification channel removed')
    return { success: true }
  })
