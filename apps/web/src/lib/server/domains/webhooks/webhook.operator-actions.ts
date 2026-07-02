/**
 * Phase 5 — operator-driven webhook actions:
 *   - test-fire (`fireTestEvent`): synchronously deliver a sample payload
 *     of a chosen event type to a single webhook so the operator can verify
 *     URL + secret without waiting for real activity.
 *   - redeliver (`redeliverDelivery`): replay a previously-recorded delivery
 *     attempt byte-for-byte using the stored `requestPayloadJson`.
 *
 * Both bypass BullMQ so the caller (route handler) can return the outcome
 * synchronously. The webhook handler itself still records each attempt to
 * `webhook_deliveries`, keeping the audit trail intact.
 */
import type { WebhookId, WebhookDeliveryId } from '@quackback/ids'
import type { EventData, EventType } from '../../events/types'
import { EVENT_TYPES } from '../../events/types'
import { getSampleEventPayload, TEST_FIRE_EVENT_ID_PREFIX } from '../../events/sample-payloads'
import { getWebhookById } from './webhook.service'
import { getDelivery } from './webhook.deliveries'
import { decryptWebhookSecret } from './encryption'
import { ValidationError, NotFoundError } from '@/lib/shared/errors'

/** Discriminator: a hook result we can report back to the operator. */
export interface OperatorDeliveryOutcome {
  success: boolean
  httpStatus?: number | null
  latencyMs?: number | null
  errorMessage?: string | null
  /** Synthetic id used for the audit row (helps the UI find it). */
  eventId: string
}

function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value)
}

/**
 * Synchronously deliver a canonical sample of `eventType` to `webhookId`.
 * Throws ValidationError if the webhook is inactive, deleted, or does not
 * subscribe to the requested event type.
 */
export async function fireTestEvent(input: {
  webhookId: WebhookId
  eventType: string
}): Promise<OperatorDeliveryOutcome> {
  if (!isEventType(input.eventType)) {
    throw new ValidationError('WEBHOOK_TEST_BAD_EVENT', `unknown event type ${input.eventType}`)
  }
  const webhook = await getWebhookById(input.webhookId)
  if (webhook.deletedAt) {
    throw new NotFoundError('WEBHOOK_NOT_FOUND', `webhook ${input.webhookId} not found`)
  }
  if (webhook.status !== 'active') {
    throw new ValidationError('WEBHOOK_INACTIVE', `webhook ${input.webhookId} is not active`)
  }
  if (!webhook.events.includes(input.eventType)) {
    throw new ValidationError(
      'WEBHOOK_NOT_SUBSCRIBED',
      `webhook is not subscribed to ${input.eventType}`
    )
  }

  // Clone the sample so we can stamp a unique runtime id (test-fire prefix)
  // — receivers can use this to identify and ignore test traffic.
  const sample = getSampleEventPayload(input.eventType)
  const eventId = `${TEST_FIRE_EVENT_ID_PREFIX}${Date.now().toString(36)}`
  const event: EventData = {
    ...sample,
    id: eventId,
    timestamp: new Date().toISOString(),
  } as EventData

  const secret = decryptWebhookSecret(webhook.secret)
  const { webhookHook } = await import('../../events/handlers/webhook')
  const result = await webhookHook.run(
    event,
    { url: webhook.url },
    { secret, webhookId: webhook.id, attemptNumber: 0 }
  )
  return {
    success: !!result.success,
    errorMessage: result.error ?? null,
    eventId,
  }
}

/**
 * Replay a previously-recorded delivery using its stored payload. Bumps the
 * `attemptNumber` by 1. Fails with 422-style ValidationError when the payload
 * was not stored (legacy row pre-Phase 5 or oversize payload truncated at write).
 */
export async function redeliverDelivery(input: {
  deliveryId: WebhookDeliveryId
}): Promise<OperatorDeliveryOutcome> {
  const delivery = await getDelivery(input.deliveryId)
  if (!delivery) {
    throw new NotFoundError('DELIVERY_NOT_FOUND', `delivery ${input.deliveryId} not found`)
  }
  const row = delivery as typeof delivery & {
    requestPayloadJson: unknown
    requestPayloadTruncated: boolean
  }
  if (!row.requestPayloadJson) {
    throw new ValidationError(
      'DELIVERY_NO_PAYLOAD',
      row.requestPayloadTruncated
        ? 'original payload was too large to store; cannot redeliver'
        : 'original payload was not captured; cannot redeliver'
    )
  }
  const payload = row.requestPayloadJson as {
    id: string
    type: EventType
    createdAt: string
    data: unknown
  }
  const webhook = await getWebhookById(delivery.webhookId as WebhookId)
  if (webhook.deletedAt) {
    throw new NotFoundError('WEBHOOK_NOT_FOUND', `webhook ${delivery.webhookId} not found`)
  }
  const event = {
    id: payload.id,
    type: payload.type,
    timestamp: payload.createdAt,
    actor: { type: 'service', service: 'quackback-redeliver', displayName: 'Redeliver' },
    data: payload.data,
  } as EventData

  const secret = decryptWebhookSecret(webhook.secret)
  const { webhookHook } = await import('../../events/handlers/webhook')
  const result = await webhookHook.run(
    event,
    { url: webhook.url },
    {
      secret,
      webhookId: webhook.id,
      attemptNumber: (delivery.attemptNumber ?? 0) + 1,
    }
  )
  return {
    success: !!result.success,
    errorMessage: result.error ?? null,
    eventId: payload.id,
  }
}
