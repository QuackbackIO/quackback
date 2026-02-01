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

// ============================================
// Schemas
// ============================================

const createWebhookSchema = z.object({
  url: z.string().url('Invalid URL format'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'At least one event is required'),
  boardIds: z.array(z.string()).optional(),
})

const updateWebhookSchema = z.object({
  webhookId: z.string(),
  url: z.string().url('Invalid URL format').optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'At least one event is required').optional(),
  boardIds: z.array(z.string()).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

const deleteWebhookSchema = z.object({
  webhookId: z.string(),
})

const rotateWebhookSecretSchema = z.object({
  webhookId: z.string(),
})

// ============================================
// Type Exports
// ============================================

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>
export type DeleteWebhookInput = z.infer<typeof deleteWebhookSchema>
export type RotateWebhookSecretInput = z.infer<typeof rotateWebhookSecretSchema>

// ============================================
// Read Operations
// ============================================

/**
 * List all webhooks for the workspace
 */
export const fetchWebhooks = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:webhooks] fetchWebhooks`)
  try {
    await requireAuth({ roles: ['admin'] })

    const { listWebhooks } = await import('@/lib/server/domains/webhooks')
    const webhooks = await listWebhooks()

    console.log(`[fn:webhooks] fetchWebhooks: count=${webhooks.length}`)
    return webhooks
  } catch (error) {
    console.error(`[fn:webhooks] fetchWebhooks failed:`, error)
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
  .inputValidator(createWebhookSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:webhooks] createWebhookFn: url=${data.url}`)
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      const { createWebhook } = await import('@/lib/server/domains/webhooks')
      const result = await createWebhook(
        {
          url: data.url,
          events: data.events,
          boardIds: data.boardIds,
        },
        auth.member.id
      )

      console.log(`[fn:webhooks] createWebhookFn: id=${result.webhook.id}`)
      return result
    } catch (error) {
      console.error(`[fn:webhooks] createWebhookFn failed:`, error)
      throw error
    }
  })

/**
 * Update a webhook
 */
export const updateWebhookFn = createServerFn({ method: 'POST' })
  .inputValidator(updateWebhookSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:webhooks] updateWebhookFn: id=${data.webhookId}`)
    try {
      await requireAuth({ roles: ['admin'] })

      const { updateWebhook } = await import('@/lib/server/domains/webhooks')
      const webhook = await updateWebhook(data.webhookId as WebhookId, {
        url: data.url,
        events: data.events,
        boardIds: data.boardIds,
        status: data.status,
      })

      console.log(`[fn:webhooks] updateWebhookFn: updated id=${webhook.id}`)
      return webhook
    } catch (error) {
      console.error(`[fn:webhooks] updateWebhookFn failed:`, error)
      throw error
    }
  })

/**
 * Delete a webhook
 */
export const deleteWebhookFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteWebhookSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:webhooks] deleteWebhookFn: id=${data.webhookId}`)
    try {
      await requireAuth({ roles: ['admin'] })

      const { deleteWebhook } = await import('@/lib/server/domains/webhooks')
      await deleteWebhook(data.webhookId as WebhookId)

      console.log(`[fn:webhooks] deleteWebhookFn: deleted`)
      return { id: data.webhookId as WebhookId }
    } catch (error) {
      console.error(`[fn:webhooks] deleteWebhookFn failed:`, error)
      throw error
    }
  })

/**
 * Rotate a webhook's signing secret
 * Returns the new secret (only shown once)
 */
export const rotateWebhookSecretFn = createServerFn({ method: 'POST' })
  .inputValidator(rotateWebhookSecretSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:webhooks] rotateWebhookSecretFn: id=${data.webhookId}`)
    try {
      await requireAuth({ roles: ['admin'] })

      const { rotateWebhookSecret } = await import('@/lib/server/domains/webhooks')
      const result = await rotateWebhookSecret(data.webhookId as WebhookId)

      console.log(`[fn:webhooks] rotateWebhookSecretFn: rotated`)
      return result
    } catch (error) {
      console.error(`[fn:webhooks] rotateWebhookSecretFn failed:`, error)
      throw error
    }
  })
