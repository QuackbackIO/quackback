/**
 * Server function for the in-app admin UI to list webhook delivery attempts.
 *
 * Mirrors the REST surface but uses cookie auth + admin-role gating instead of
 * scoped API keys. Only admins can read this — webhook payloads can contain
 * sensitive event data.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import type { WebhookId, WebhookDeliveryId } from '@quackback/ids'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'

const STATUSES = [
  'queued',
  'success',
  'failed_retryable',
  'failed_terminal',
  'blocked_ssrf',
] as const

const listInput = z.object({
  webhookId: z.string(),
  limit: z.number().int().min(1).max(200).optional().default(50),
  status: z.enum(STATUSES).optional(),
  cursorAttemptedAt: z.string().datetime().optional(),
  cursorId: z.string().optional(),
})

export const listWebhookDeliveriesFn = createServerFn({ method: 'GET' })
  .inputValidator(listInput)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    const { listDeliveriesForWebhook } =
      await import('@/lib/server/domains/webhooks/webhook.deliveries')
    const cursor =
      data.cursorAttemptedAt && data.cursorId
        ? {
            attemptedAt: new Date(data.cursorAttemptedAt),
            id: data.cursorId as WebhookDeliveryId,
          }
        : null

    const rows = await listDeliveriesForWebhook(data.webhookId as WebhookId, {
      cursor,
      limit: data.limit,
      statusFilter: data.status ?? null,
    })

    const nextCursor =
      rows.length === data.limit
        ? {
            cursorAttemptedAt: toIsoString(rows[rows.length - 1].attemptedAt),
            cursorId: rows[rows.length - 1].id,
          }
        : null

    return {
      deliveries: rows.map((r) => ({
        id: r.id,
        webhookId: r.webhookId,
        eventId: r.eventId,
        eventType: r.eventType,
        attemptNumber: r.attemptNumber,
        status: r.status,
        httpStatus: r.httpStatus,
        errorMessage: r.errorMessage,
        requestUrl: r.requestUrl,
        requestPayloadBytes: r.requestPayloadBytes,
        responseBodySnippet: r.responseBodySnippet,
        latencyMs: r.latencyMs,
        signatureTimestamp: r.signatureTimestamp,
        attemptedAt: toIsoString(r.attemptedAt),
        nextRetryAt: toIsoStringOrNull(r.nextRetryAt),
        canRedeliver:
          (r.status === 'failed_retryable' || r.status === 'failed_terminal') &&
          (r as { requestPayloadJson?: unknown }).requestPayloadJson != null &&
          !(r as { requestPayloadTruncated?: boolean }).requestPayloadTruncated,
      })),
      nextCursor,
    }
  })
