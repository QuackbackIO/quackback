import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { db, integrations, integrationEventMappings, eq, and, sql } from '@/lib/server/db'
import type { IntegrationId } from '@quackback/ids'

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
  .inputValidator(updateIntegrationSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:integrations] updateIntegrationFn: id=${data.id}`)
    await requireAuth({ roles: ['admin'] })

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

    console.log(`[fn:integrations] updateIntegrationFn: updated id=${data.id}`)
    return { success: true }
  })

/**
 * Delete an integration
 */
export const deleteIntegrationFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteIntegrationSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:integrations] deleteIntegrationFn: id=${data.id}`)
    await requireAuth({ roles: ['admin'] })

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
        console.error(
          `[fn:integrations] onDisconnect failed for ${integration.integrationType}:`,
          err
        )
        // Continue with deletion even if revocation fails
      }
    }

    await db.delete(integrations).where(eq(integrations.id, integrationId))

    console.log(`[fn:integrations] deleteIntegrationFn: deleted id=${data.id}`)
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
  .inputValidator(addNotificationChannelSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:integrations] addNotificationChannelFn: channelId=${data.channelId}`)
    await requireAuth({ roles: ['admin'] })

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

    console.log(`[fn:integrations] addNotificationChannelFn: added ${data.events.length} mappings`)
    return { success: true }
  })

/**
 * Update a notification channel's event mappings and board filter
 */
export const updateNotificationChannelFn = createServerFn({ method: 'POST' })
  .inputValidator(updateNotificationChannelSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:integrations] updateNotificationChannelFn: channelId=${data.channelId}`)
    await requireAuth({ roles: ['admin'] })

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

    console.log(`[fn:integrations] updateNotificationChannelFn: updated`)
    return { success: true }
  })

/**
 * Remove a notification channel and all its event mappings
 */
export const removeNotificationChannelFn = createServerFn({ method: 'POST' })
  .inputValidator(removeNotificationChannelSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:integrations] removeNotificationChannelFn: channelId=${data.channelId}`)
    await requireAuth({ roles: ['admin'] })

    const integrationId = data.integrationId as IntegrationId

    await db
      .delete(integrationEventMappings)
      .where(
        and(
          eq(integrationEventMappings.integrationId, integrationId),
          eq(integrationEventMappings.targetKey, data.channelId)
        )
      )

    console.log(`[fn:integrations] removeNotificationChannelFn: removed`)
    return { success: true }
  })
