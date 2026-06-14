import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import {
  db,
  integrations,
  integrationEventMappings,
  integrationUserMappings,
  integrationSyncLog,
  slackChannelMonitors,
  eq,
  and,
  sql,
} from '@/lib/server/db'
import type { IntegrationId, BoardId, PrincipalId } from '@quackback/ids'
import type { EventMappingFilters } from '@/lib/server/db'
import { toIsoString } from '@/lib/shared/utils'
// cacheDel/CACHE_KEYS are imported dynamically inside handlers to keep ioredis out of the client bundle

// ============================================
// Schemas
// ============================================

const eventMappingFiltersSchema = z.record(
  z.string(),
  z.union([z.array(z.string()), z.string(), z.boolean(), z.number()])
)

const updateIntegrationSchema = z.object({
  id: z.string(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  eventMappings: z
    .array(
      z.object({
        eventType: z.string(),
        enabled: z.boolean(),
        filters: eventMappingFiltersSchema.nullable().optional(),
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
            filters: (mapping.filters ?? null) as EventMappingFilters | null,
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

      for (const mapping of data.eventMappings) {
        if (mapping.filters === undefined) continue

        await db
          .update(integrationEventMappings)
          .set({
            filters: (mapping.filters ?? null) as EventMappingFilters | null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(integrationEventMappings.integrationId, integrationId),
              eq(integrationEventMappings.eventType, mapping.eventType),
              eq(integrationEventMappings.actionType, 'send_message'),
              eq(integrationEventMappings.targetKey, 'default')
            )
          )
      }
    }

    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
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

    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
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

    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
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

    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
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

    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)
    console.log(`[fn:integrations] removeNotificationChannelFn: removed`)
    return { success: true }
  })

// ============================================
// Monitored Channel CRUD (Slack Channel Monitoring)
// ============================================

const addMonitoredChannelSchema = z.object({
  integrationId: z.string(),
  channelId: z.string(),
  channelName: z.string(),
  isPrivate: z.boolean().default(false),
  boardId: z.string().nullable().optional(),
})

const updateMonitoredChannelSchema = z.object({
  integrationId: z.string(),
  channelId: z.string(),
  enabled: z.boolean().optional(),
  boardId: z.string().nullable().optional(),
})

const removeMonitoredChannelSchema = z.object({
  integrationId: z.string(),
  channelId: z.string(),
})

export type AddMonitoredChannelInput = z.infer<typeof addMonitoredChannelSchema>
export type UpdateMonitoredChannelInput = z.infer<typeof updateMonitoredChannelSchema>
export type RemoveMonitoredChannelInput = z.infer<typeof removeMonitoredChannelSchema>

/**
 * Add a channel to monitoring. Bot joins the channel automatically (public only).
 */
export const addMonitoredChannelFn = createServerFn({ method: 'POST' })
  .inputValidator(addMonitoredChannelSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:integrations] addMonitoredChannelFn: channelId=${data.channelId}`)
    await requireAuth({ roles: ['admin'] })

    const integrationId = data.integrationId as IntegrationId

    // Bot joins the channel (only works for public channels)
    if (!data.isPrivate) {
      try {
        const { decryptSecrets } = await import('@/lib/server/integrations/encryption')
        const { joinSlackChannel } = await import('@/lib/server/integrations/slack/channels')
        const integration = await db.query.integrations.findFirst({
          where: eq(integrations.id, integrationId),
          columns: { secrets: true },
        })
        if (integration?.secrets) {
          const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
          await joinSlackChannel(secrets.accessToken, data.channelId)
        }
      } catch (err) {
        console.warn(`[fn:integrations] Failed to join channel ${data.channelId}:`, err)
        // Continue -- bot might already be in the channel
      }
    }

    await db
      .insert(slackChannelMonitors)
      .values({
        integrationId,
        channelId: data.channelId,
        channelName: data.channelName,
        boardId: (data.boardId ?? null) as BoardId | null,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: [slackChannelMonitors.integrationId, slackChannelMonitors.channelId],
        set: {
          channelName: data.channelName,
          boardId: (data.boardId ?? null) as BoardId | null,
          enabled: true,
          updatedAt: new Date(),
        },
      })

    console.log(`[fn:integrations] addMonitoredChannelFn: added ${data.channelId}`)
    return { success: true }
  })

/**
 * Update a monitored channel (toggle enabled, change board)
 */
export const updateMonitoredChannelFn = createServerFn({ method: 'POST' })
  .inputValidator(updateMonitoredChannelSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:integrations] updateMonitoredChannelFn: channelId=${data.channelId}`)
    await requireAuth({ roles: ['admin'] })

    const integrationId = data.integrationId as IntegrationId
    const updates: Partial<typeof slackChannelMonitors.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (data.enabled !== undefined) updates.enabled = data.enabled
    if (data.boardId !== undefined) updates.boardId = (data.boardId ?? null) as BoardId | null

    await db
      .update(slackChannelMonitors)
      .set(updates)
      .where(
        and(
          eq(slackChannelMonitors.integrationId, integrationId),
          eq(slackChannelMonitors.channelId, data.channelId)
        )
      )

    console.log(`[fn:integrations] updateMonitoredChannelFn: updated`)
    return { success: true }
  })

/**
 * Remove a monitored channel
 */
export const removeMonitoredChannelFn = createServerFn({ method: 'POST' })
  .inputValidator(removeMonitoredChannelSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:integrations] removeMonitoredChannelFn: channelId=${data.channelId}`)
    await requireAuth({ roles: ['admin'] })

    const integrationId = data.integrationId as IntegrationId

    await db
      .delete(slackChannelMonitors)
      .where(
        and(
          eq(slackChannelMonitors.integrationId, integrationId),
          eq(slackChannelMonitors.channelId, data.channelId)
        )
      )

    console.log(`[fn:integrations] removeMonitoredChannelFn: removed`)
    return { success: true }
  })

// ============================================
// Integration User Mapping CRUD
// ============================================

const fetchUserMappingsSchema = z.object({
  integrationId: z.string(),
})

const upsertUserMappingSchema = z.object({
  integrationId: z.string(),
  externalUsername: z.string().min(1),
  externalDisplayName: z.string().optional(),
  principalId: z.string(),
})

const deleteUserMappingSchema = z.object({
  integrationId: z.string(),
  externalUsername: z.string(),
})

export type UpsertUserMappingInput = z.infer<typeof upsertUserMappingSchema>
export type DeleteUserMappingInput = z.infer<typeof deleteUserMappingSchema>

/**
 * Fetch user mappings for an integration
 */
export const fetchUserMappingsFn = createServerFn({ method: 'GET' })
  .inputValidator(fetchUserMappingsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    return db.query.integrationUserMappings.findMany({
      where: eq(integrationUserMappings.integrationId, data.integrationId as IntegrationId),
      orderBy: (m, { asc }) => [asc(m.externalUsername)],
    })
  })

/**
 * Create or update a user mapping
 */
export const upsertUserMappingFn = createServerFn({ method: 'POST' })
  .inputValidator(upsertUserMappingSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    await db
      .insert(integrationUserMappings)
      .values({
        integrationId: data.integrationId as IntegrationId,
        externalUsername: data.externalUsername,
        externalDisplayName: data.externalDisplayName ?? null,
        principalId: data.principalId as PrincipalId,
      })
      .onConflictDoUpdate({
        target: [integrationUserMappings.integrationId, integrationUserMappings.externalUsername],
        set: {
          principalId: data.principalId as PrincipalId,
          externalDisplayName: data.externalDisplayName ?? null,
          updatedAt: new Date(),
        },
      })

    return { success: true }
  })

/**
 * Delete a user mapping
 */
export const deleteUserMappingFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteUserMappingSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    await db
      .delete(integrationUserMappings)
      .where(
        and(
          eq(integrationUserMappings.integrationId, data.integrationId as IntegrationId),
          eq(integrationUserMappings.externalUsername, data.externalUsername)
        )
      )

    return { success: true }
  })

// ============================================
// Integration Sync Log
// ============================================

const fetchSyncLogSchema = z.object({
  integrationId: z.string(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  statusFilter: z.enum(['all', 'failed']).optional(),
})

/**
 * Fetch paginated sync log entries for an integration (most recent first).
 */
export const fetchSyncLogFn = createServerFn({ method: 'GET' })
  .inputValidator(fetchSyncLogSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const { desc, lt, tickets } = await import('@/lib/server/db')

    const limit = data.limit ?? 25
    const conditions = [eq(integrationSyncLog.integrationId, data.integrationId as IntegrationId)]

    if (data.statusFilter === 'failed') {
      conditions.push(eq(integrationSyncLog.status, 'failed'))
    }

    if (data.cursor) {
      conditions.push(lt(integrationSyncLog.createdAt, new Date(data.cursor)))
    }

    const rows = await db
      .select({
        id: integrationSyncLog.id,
        ticketId: integrationSyncLog.ticketId,
        externalId: integrationSyncLog.externalId,
        eventType: integrationSyncLog.eventType,
        direction: integrationSyncLog.direction,
        status: integrationSyncLog.status,
        errorMessage: integrationSyncLog.errorMessage,
        durationMs: integrationSyncLog.durationMs,
        createdAt: integrationSyncLog.createdAt,
        ticketSubject: tickets.subject,
      })
      .from(integrationSyncLog)
      .leftJoin(tickets, eq(integrationSyncLog.ticketId, tickets.id))
      .where(and(...conditions))
      .orderBy(desc(integrationSyncLog.createdAt))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = rows.slice(0, limit)
    const nextCursor = hasMore ? toIsoString(items[items.length - 1].createdAt) : null

    return { items, nextCursor }
  })
