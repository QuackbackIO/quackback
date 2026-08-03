/**
 * Append-only audit log of webhook delivery attempts.
 *
 * Every dispatch outcome — success, retryable failure, terminal failure, or
 * SSRF block — is recorded here, decoupled from the live `webhooks` row's
 * `failureCount`/`lastError` cache. Writes are best-effort: an INSERT
 * failure must never block a delivery from being processed.
 */

import {
  db,
  eq,
  and,
  or,
  lt,
  desc,
  sql,
  webhookDeliveries,
  type WebhookDelivery,
} from '@/lib/server/db'
import type { WebhookId, WebhookDeliveryId } from '@quackback/ids'

export type WebhookDeliveryStatus =
  | 'queued'
  | 'success'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'blocked_ssrf'

export interface RecordDeliveryAttemptInput {
  webhookId: WebhookId
  eventId: string
  eventType: string
  attemptNumber: number
  status: WebhookDeliveryStatus
  httpStatus?: number | null
  errorMessage?: string | null
  requestUrl: string
  requestPayloadBytes: number
  /** Full event envelope as POSTed; null when the writer chose not to store it. */
  requestPayloadJson?: unknown
  /** True when the payload exceeded the writer's storage cap and was dropped. */
  requestPayloadTruncated?: boolean
  responseBodySnippet?: string | null
  latencyMs?: number | null
  signatureTimestamp: number
  nextRetryAt?: Date | null
}

const SNIPPET_MAX = 500

/**
 * Fire-and-forget INSERT. Never throws; logs warnings on failure so the
 * caller can stay focused on the delivery outcome.
 */
export async function recordDeliveryAttempt(input: RecordDeliveryAttemptInput): Promise<void> {
  try {
    const snippet =
      input.responseBodySnippet != null ? input.responseBodySnippet.slice(0, SNIPPET_MAX) : null
    await db.insert(webhookDeliveries).values({
      webhookId: input.webhookId,
      eventId: input.eventId,
      eventType: input.eventType,
      attemptNumber: input.attemptNumber,
      status: input.status,
      httpStatus: input.httpStatus ?? null,
      errorMessage: input.errorMessage ?? null,
      requestUrl: input.requestUrl,
      requestPayloadBytes: input.requestPayloadBytes,
      requestPayloadJson: input.requestPayloadJson ?? null,
      requestPayloadTruncated: input.requestPayloadTruncated ?? false,
      responseBodySnippet: snippet,
      latencyMs: input.latencyMs ?? null,
      signatureTimestamp: input.signatureTimestamp,
      nextRetryAt: input.nextRetryAt ?? null,
    })
  } catch (err) {
    console.warn('[webhook.deliveries] recordDeliveryAttempt failed', err)
  }
}

export interface ListDeliveriesCursor {
  attemptedAt: Date
  id: WebhookDeliveryId
}

export interface ListDeliveriesOptions {
  cursor?: ListDeliveriesCursor | null
  limit?: number
  statusFilter?: WebhookDeliveryStatus | null
}

export async function listDeliveriesForWebhook(
  webhookId: WebhookId,
  options: ListDeliveriesOptions = {}
): Promise<WebhookDelivery[]> {
  const { cursor, limit = 50, statusFilter } = options
  const conditions = [eq(webhookDeliveries.webhookId, webhookId)]
  if (statusFilter) conditions.push(eq(webhookDeliveries.status, statusFilter))
  if (cursor) {
    conditions.push(
      or(
        lt(webhookDeliveries.attemptedAt, cursor.attemptedAt),
        and(
          eq(webhookDeliveries.attemptedAt, cursor.attemptedAt),
          lt(webhookDeliveries.id, cursor.id)
        )
      )!
    )
  }
  return db
    .select()
    .from(webhookDeliveries)
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.attemptedAt), desc(webhookDeliveries.id))
    .limit(limit)
}

export interface ListFailedDeliveriesOptions {
  sinceMs?: number
  limit?: number
}

export async function listFailedDeliveries(
  options: ListFailedDeliveriesOptions = {}
): Promise<WebhookDelivery[]> {
  const { sinceMs, limit = 100 } = options
  const conditions = [sql`${webhookDeliveries.status} IN ('failed_retryable', 'failed_terminal')`]
  if (sinceMs && sinceMs > 0) {
    const since = new Date(Date.now() - sinceMs)
    conditions.push(sql`${webhookDeliveries.attemptedAt} >= ${since}`)
  }
  return db
    .select()
    .from(webhookDeliveries)
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.attemptedAt))
    .limit(limit)
}

export async function getDelivery(id: WebhookDeliveryId): Promise<WebhookDelivery | null> {
  const [row] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, id))
    .limit(1)
  return row ?? null
}
