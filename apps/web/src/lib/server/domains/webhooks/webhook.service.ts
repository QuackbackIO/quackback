/**
 * Webhook Service - Business logic for webhook operations
 *
 * Shared by both API routes and admin UI server functions.
 */

import crypto from 'crypto'
import { db, webhooks, eq, sql } from '@/lib/server/db'
import { createId, type MemberId, type WebhookId } from '@quackback/ids'
import { encryptWebhookSecret } from './encryption'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { isValidWebhookUrl } from '@/lib/server/events/integrations/webhook/constants'

/** Maximum webhooks per workspace */
const MAX_WEBHOOKS = 25

export interface Webhook {
  id: WebhookId
  url: string
  events: string[]
  boardIds: string[] | null
  status: 'active' | 'disabled'
  failureCount: number
  lastError: string | null
  lastTriggeredAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdById: MemberId
}

export interface CreateWebhookInput {
  url: string
  events: string[]
  boardIds?: string[]
}

export interface CreateWebhookResult {
  webhook: Webhook
  /** The signing secret - only returned on creation, never stored in plain text retrieval */
  secret: string
}

export interface UpdateWebhookInput {
  url?: string
  events?: string[]
  boardIds?: string[] | null
  status?: 'active' | 'disabled'
}

/**
 * Generate a webhook signing secret
 */
function generateSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`
}

/**
 * Create a new webhook
 */
export async function createWebhook(
  input: CreateWebhookInput,
  createdById: MemberId
): Promise<CreateWebhookResult> {
  // Validate URL
  if (!input.url?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Webhook URL is required')
  }
  if (!isValidWebhookUrl(input.url)) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Invalid webhook URL: must be HTTPS and cannot target private networks'
    )
  }

  // Validate events
  if (!input.events || input.events.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'At least one event is required')
  }

  // Check webhook limit
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(webhooks)
  if (count >= MAX_WEBHOOKS) {
    throw new ValidationError(
      'WEBHOOK_LIMIT_REACHED',
      `Maximum of ${MAX_WEBHOOKS} webhooks allowed per workspace`
    )
  }

  // Generate signing secret
  const secret = generateSecret()
  const webhookId = createId('webhook')

  // Encrypt secret for storage using webhookId as salt
  const secretEncrypted = encryptWebhookSecret(secret)

  // Create webhook
  const [webhook] = await db
    .insert(webhooks)
    .values({
      id: webhookId,
      createdById,
      url: input.url,
      secret: secretEncrypted,
      events: input.events,
      boardIds: input.boardIds ?? null,
    })
    .returning()

  return {
    webhook: mapWebhook(webhook),
    secret,
  }
}

/**
 * List all webhooks
 */
export async function listWebhooks(): Promise<Webhook[]> {
  const result = await db.query.webhooks.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  })

  return result.map(mapWebhook)
}

/**
 * Get a webhook by ID
 */
export async function getWebhookById(id: WebhookId): Promise<Webhook> {
  const webhook = await db.query.webhooks.findFirst({
    where: eq(webhooks.id, id),
  })

  if (!webhook) {
    throw new NotFoundError('WEBHOOK_NOT_FOUND', 'Webhook not found')
  }

  return mapWebhook(webhook)
}

/**
 * Update a webhook
 */
export async function updateWebhook(id: WebhookId, input: UpdateWebhookInput): Promise<Webhook> {
  // Validate URL if provided
  if (input.url !== undefined) {
    if (!input.url?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Webhook URL cannot be empty')
    }
    if (!isValidWebhookUrl(input.url)) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'Invalid webhook URL: must be HTTPS and cannot target private networks'
      )
    }
  }

  // Validate events if provided
  if (input.events !== undefined && input.events.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'At least one event is required')
  }

  // Build update object
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (input.url !== undefined) updateData.url = input.url
  if (input.events !== undefined) updateData.events = input.events
  if (input.boardIds !== undefined) updateData.boardIds = input.boardIds
  if (input.status !== undefined) {
    updateData.status = input.status
    // Reset failure count when re-enabling
    if (input.status === 'active') {
      updateData.failureCount = 0
      updateData.lastError = null
    }
  }

  const [webhook] = await db.update(webhooks).set(updateData).where(eq(webhooks.id, id)).returning()

  if (!webhook) {
    throw new NotFoundError('WEBHOOK_NOT_FOUND', 'Webhook not found')
  }

  return mapWebhook(webhook)
}

/**
 * Delete a webhook
 */
export async function deleteWebhook(id: WebhookId): Promise<void> {
  const [deleted] = await db.delete(webhooks).where(eq(webhooks.id, id)).returning()

  if (!deleted) {
    throw new NotFoundError('WEBHOOK_NOT_FOUND', 'Webhook not found')
  }
}

/**
 * Rotate a webhook's signing secret
 * Returns the new secret (only shown once)
 */
export async function rotateWebhookSecret(
  id: WebhookId
): Promise<{ webhook: Webhook; secret: string }> {
  // Generate new secret
  const secret = generateSecret()
  const secretEncrypted = encryptWebhookSecret(secret)

  // Update webhook with new secret
  const [webhook] = await db
    .update(webhooks)
    .set({
      secret: secretEncrypted,
      updatedAt: new Date(),
    })
    .where(eq(webhooks.id, id))
    .returning()

  if (!webhook) {
    throw new NotFoundError('WEBHOOK_NOT_FOUND', 'Webhook not found')
  }

  return {
    webhook: mapWebhook(webhook),
    secret,
  }
}

/**
 * Map database webhook to service type
 */
function mapWebhook(w: typeof webhooks.$inferSelect): Webhook {
  return {
    id: w.id,
    url: w.url,
    events: w.events,
    boardIds: w.boardIds,
    status: w.status as 'active' | 'disabled',
    failureCount: w.failureCount,
    lastError: w.lastError,
    lastTriggeredAt: w.lastTriggeredAt,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    createdById: w.createdById,
  }
}
