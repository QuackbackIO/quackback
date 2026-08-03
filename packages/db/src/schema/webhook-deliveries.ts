import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  index,
  jsonb,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { webhooks } from './webhooks'

/**
 * Append-only audit log of webhook delivery attempts. One row per attempt,
 * keyed by `(webhookId, eventId, attemptNumber)` semantically (not via a
 * unique constraint — duplicates from at-least-once jobs are tolerated).
 *
 * `status` ∈ ('queued','success','failed_retryable','failed_terminal','blocked_ssrf').
 *
 * `responseBodySnippet` is truncated to ≤500 chars by the writer.
 *
 * `requestPayloadJson` stores the full event envelope (`{id,type,createdAt,data}`)
 * exactly as it was POSTed, so the operator-facing redeliver action can replay
 * the original byte-for-byte. Capped at ~32 KB by the writer; oversized
 * payloads are stored as `null` with `requestPayloadTruncated = true` and
 * become non-redeliverable (rare for ticketing payloads).
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: typeIdWithDefault('wh_deliv')('id').primaryKey(),
    webhookId: typeIdColumn('webhook')('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status').notNull(),
    httpStatus: integer('http_status'),
    errorMessage: text('error_message'),
    requestUrl: text('request_url').notNull(),
    requestPayloadBytes: integer('request_payload_bytes').notNull(),
    requestPayloadJson: jsonb('request_payload_json'),
    requestPayloadTruncated: boolean('request_payload_truncated').default(false).notNull(),
    responseBodySnippet: text('response_body_snippet'),
    latencyMs: integer('latency_ms'),
    signatureTimestamp: bigint('signature_timestamp', { mode: 'number' }).notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  },
  (table) => [
    index('webhook_deliveries_webhook_attempted_idx').on(table.webhookId, table.attemptedAt),
    index('webhook_deliveries_event_idx').on(table.eventId),
    index('webhook_deliveries_failed_idx')
      .on(table.status, table.attemptedAt)
      .where(sql`status IN ('failed_retryable', 'failed_terminal')`),
  ]
)

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookDeliveries.webhookId],
    references: [webhooks.id],
  }),
}))

export type WebhookDeliveryStatus =
  | 'queued'
  | 'success'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'blocked_ssrf'
