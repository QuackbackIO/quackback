/**
 * Server functions for webhook admin operations
 *
 * Uses shared service layer for business logic.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { WEBHOOK_EVENTS } from '@/lib/server/events/integrations/webhook/constants'
import type { WebhookId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'webhooks' })

// ============================================
// Schemas
// ============================================

const createWebhookSchema = z.object({
  url: z.string().url('Invalid URL format'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'At least one event is required'),
  boardIds: z.array(z.string()).optional(),
  inboxIds: z.array(z.string()).optional(),
})

const updateWebhookSchema = z.object({
  webhookId: z.string(),
  url: z.string().url('Invalid URL format').optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'At least one event is required').optional(),
  boardIds: z.array(z.string()).nullable().optional(),
  inboxIds: z.array(z.string()).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

const deleteWebhookSchema = z.object({
  webhookId: z.string(),
})

const rotateWebhookSecretSchema = z.object({
  webhookId: z.string(),
})

const testWebhookSchema = z.object({
  webhookId: z.string(),
  eventType: z.enum(WEBHOOK_EVENTS),
})

const redeliverWebhookDeliverySchema = z.object({
  webhookId: z.string(),
  deliveryId: z.string(),
})

// ============================================
// Type Exports
// ============================================

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>
export type DeleteWebhookInput = z.infer<typeof deleteWebhookSchema>
export type RotateWebhookSecretInput = z.infer<typeof rotateWebhookSecretSchema>
export type TestWebhookInput = z.infer<typeof testWebhookSchema>
export type RedeliverWebhookDeliveryInput = z.infer<typeof redeliverWebhookDeliverySchema>

// ============================================
// Read Operations
// ============================================

/**
 * List all webhooks for the workspace
 */
export const fetchWebhooks = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug({}, 'fetch webhooks')
  try {
    await requireAuth({ roles: ['admin'] })

    const { listWebhooks } = await import('@/lib/server/domains/webhooks/webhook.service')
    const webhooks = await listWebhooks()

    log.debug({ count: webhooks.length }, 'fetch webhooks')
    return webhooks
  } catch (error) {
    log.error({ err: error }, 'fetch webhooks failed')
    throw error
  }
})

// ============================================
// Write Operations
// ============================================

/**
 * Create a new webhook
 * Returns the webhook with secret (only shown once)
 */
export const createWebhookFn = createServerFn({ method: 'POST' })
  .validator(createWebhookSchema)
  .handler(async ({ data }) => {
    log.debug({ url: data.url }, 'create webhook')
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      const { createWebhook } = await import('@/lib/server/domains/webhooks/webhook.service')
      const result = await createWebhook(
        {
          url: data.url,
          events: data.events,
          boardIds: data.boardIds,
          inboxIds: data.inboxIds,
        },
        auth.principal.id
      )

      log.info({ webhook_id: result.webhook.id }, 'webhook created')
      return result
    } catch (error) {
      log.error({ err: error }, 'create webhook failed')
      throw error
    }
  })

/**
 * Update a webhook
 */
export const updateWebhookFn = createServerFn({ method: 'POST' })
  .validator(updateWebhookSchema)
  .handler(async ({ data }) => {
    log.debug({ webhook_id: data.webhookId }, 'update webhook')
    try {
      await requireAuth({ roles: ['admin'] })

      const { updateWebhook } = await import('@/lib/server/domains/webhooks/webhook.service')
      const webhook = await updateWebhook(data.webhookId as WebhookId, {
        url: data.url,
        events: data.events,
        boardIds: data.boardIds,
        inboxIds: data.inboxIds,
        status: data.status,
      })

      log.info({ webhook_id: webhook.id }, 'webhook updated')
      return webhook
    } catch (error) {
      log.error({ err: error }, 'update webhook failed')
      throw error
    }
  })

/**
 * Delete a webhook
 */
export const deleteWebhookFn = createServerFn({ method: 'POST' })
  .validator(deleteWebhookSchema)
  .handler(async ({ data }) => {
    log.debug({ webhook_id: data.webhookId }, 'delete webhook')
    try {
      await requireAuth({ roles: ['admin'] })

      const { deleteWebhook } = await import('@/lib/server/domains/webhooks/webhook.service')
      await deleteWebhook(data.webhookId as WebhookId)

      log.info({ webhook_id: data.webhookId }, 'webhook deleted')
      return { id: data.webhookId as WebhookId }
    } catch (error) {
      log.error({ err: error }, 'delete webhook failed')
      throw error
    }
  })

/**
 * Rotate a webhook's signing secret
 * Returns the new secret (only shown once)
 */
export const rotateWebhookSecretFn = createServerFn({ method: 'POST' })
  .validator(rotateWebhookSecretSchema)
  .handler(async ({ data }) => {
    log.debug({ webhook_id: data.webhookId }, 'rotate webhook secret')
    try {
      await requireAuth({ roles: ['admin'] })

      const { rotateWebhookSecret } = await import('@/lib/server/domains/webhooks/webhook.service')
      const result = await rotateWebhookSecret(data.webhookId as WebhookId)

      log.info({ webhook_id: data.webhookId }, 'webhook secret rotated')
      return result
    } catch (error) {
      log.error({ err: error }, 'rotate webhook secret failed')
      throw error
    }
  })

/**
 * Synchronously fire a sample event of `eventType` to a webhook for
 * verification. The attempt is logged in `webhook_deliveries` like a real
 * delivery (eventId prefixed `evt_test_`).
 */
export const testWebhookFn = createServerFn({ method: 'POST' })
  .inputValidator(testWebhookSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:webhooks] testWebhookFn: id=${data.webhookId} type=${data.eventType}`)
    try {
      await requireAuth({ roles: ['admin'] })
      const { fireTestEvent } =
        await import('@/lib/server/domains/webhooks/webhook.operator-actions')
      return await fireTestEvent({
        webhookId: data.webhookId as WebhookId,
        eventType: data.eventType,
      })
    } catch (error) {
      console.error(`[fn:webhooks] testWebhookFn failed:`, error)
      throw error
    }
  })

/**
 * Replay a previously-recorded delivery using its stored payload. Bumps
 * `attemptNumber` by 1.
 */
export const redeliverWebhookDeliveryFn = createServerFn({ method: 'POST' })
  .inputValidator(redeliverWebhookDeliverySchema)
  .handler(async ({ data }) => {
    console.log(`[fn:webhooks] redeliverWebhookDeliveryFn: deliveryId=${data.deliveryId}`)
    try {
      await requireAuth({ roles: ['admin'] })
      const { redeliverDelivery } =
        await import('@/lib/server/domains/webhooks/webhook.operator-actions')
      return await redeliverDelivery({
        deliveryId: data.deliveryId as import('@quackback/ids').WebhookDeliveryId,
      })
    } catch (error) {
      console.error(`[fn:webhooks] redeliverWebhookDeliveryFn failed:`, error)
      throw error
    }
  })

/**
 * Returns a record of canonical sample payloads keyed by event type, used by
 * the create/edit dialog payload-preview accordion.
 */
export const fetchSamplePayloadsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
  const { getAllSampleEventPayloads } = await import('@/lib/server/events/sample-payloads')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getAllSampleEventPayloads() as any
})
