/**
 * Self-serve billing tables.
 *
 * These exist to bill *this workspace* for its use of Quackback — they are
 * unrelated to the payment-provider integration under
 * `apps/web/src/integrations/`, which reads a *customer's* own account to
 * annotate their feedback with revenue. Same vendor, opposite direction of
 * money.
 *
 * Every table here is inert on an install with no billing provider
 * configured: nothing writes to them, nothing reads them, and the admin UI
 * that would render them is not mounted. See
 * `apps/web/src/lib/server/domains/billing/BILLING.md`.
 *
 * Plan and entitlement state deliberately does NOT live here — it lives in
 * `settings.cloud`, written through `writeCloudConfig()`, so that the
 * declarative config file and this module share one enforcement path. What
 * lives here is only what the *provider* relationship needs: which events
 * have been consumed, what usage has been billed, and the last subscription
 * snapshot applied.
 */
import { pgTable, text, timestamp, integer, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { typeIdWithDefault } from '@quackback/ids/drizzle'

/**
 * Consumed provider webhook events, keyed by the provider's own event id.
 *
 * This is the idempotency ledger. A provider redelivers on any non-2xx and
 * on its own schedule, so the same event id arrives many times; the unique
 * primary key makes the second arrival a no-op rather than a second state
 * transition. Rows are retained (not deleted on success) because a
 * redelivery can arrive days later — the pruning window has to exceed the
 * provider's retry horizon, so a sweep should target months, not hours.
 */
export const billingWebhookEvents = pgTable(
  'billing_webhook_events',
  {
    /** The provider's event id (e.g. `evt_…`). Primary key: this IS the dedupe. */
    providerEventId: text('provider_event_id').primaryKey(),
    /** Provider identifier, so a future second provider cannot collide ids. */
    provider: text('provider').notNull(),
    /** Provider event type (e.g. `customer.subscription.updated`). */
    eventType: text('event_type').notNull(),
    /** Provider-reported creation time. Diagnostics only — never an ordering key. */
    providerCreatedAt: timestamp('provider_created_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set once the handler committed. NULL means claimed but not yet finished. */
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** Last handler error, for support. NULL on success. */
    lastError: text('last_error'),
  },
  (t) => [index('billing_webhook_events_received_at_idx').on(t.receivedAt)]
)

/**
 * The usage ledger: one row per billable unit this workspace produced.
 *
 * Derived from the product's own data rather than accumulated by a counter,
 * so it can be rebuilt by re-running the derivation. `sourceId` is the id of
 * the product row that caused the charge (an assistant involvement, for the
 * resolved-outcome meter), and `(meter, source_id)` is unique — which is what
 * makes both the derivation sweep and the provider push safe to re-run.
 *
 * `reportedAt` separates "we owe the provider this" from "the provider has
 * it", so a failed push retries without double-counting and a crash between
 * the two leaves a visible, self-healing gap.
 */
export const billingUsageEvents = pgTable(
  'billing_usage_events',
  {
    id: typeIdWithDefault('billing_usage')('id').primaryKey(),
    /** Meter key, e.g. `resolved_outcome`. */
    meter: text('meter').notNull(),
    /**
     * The product row this unit was derived from. Unique per meter, forever:
     * one resolved conversation is one billable outcome even if the product
     * later reopens and re-resolves it.
     */
    sourceId: text('source_id').notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** When the product event happened (not when it was derived). */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** When the provider accepted it. NULL = owed but not yet pushed. */
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('billing_usage_events_meter_source_key').on(t.meter, t.sourceId),
    // The push query: unreported rows, oldest first.
    index('billing_usage_events_unreported_idx').on(t.reportedAt, t.occurredAt),
  ]
)

/** Quantities last pushed to the provider, per subscription item. */
export interface BillingSyncedQuantities {
  fullSeats?: number
  liteSeats?: number
  copilotSeats?: number
}

/**
 * Singleton row mirroring the provider-side subscription.
 *
 * Not a second source of truth for plan or entitlements — those live in
 * `settings.cloud`. This carries only what the provider relationship needs
 * and `settings.cloud` deliberately does not model: the snapshot ordering
 * guard and the last-synced seat quantities.
 *
 * `snapshotFetchedAt` is the ordering guard. Every subscription webhook
 * re-fetches the subscription from the provider API rather than trusting the
 * event payload, and an older fetch is refused when a newer one has already
 * been applied. That makes out-of-order delivery a no-op instead of a
 * regression, without needing the provider to supply a version number.
 */
export const billingSubscriptionState = pgTable('billing_subscription_state', {
  /** Provider subscription id. Primary key: at most one live subscription. */
  subscriptionRef: text('subscription_ref').primaryKey(),
  provider: text('provider').notNull(),
  customerRef: text('customer_ref').notNull(),
  /** When the snapshot this row reflects was read from the provider API. */
  snapshotFetchedAt: timestamp('snapshot_fetched_at', { withTimezone: true }).notNull(),
  /** Quantities last successfully pushed, so an unchanged seat count is a no-op. */
  syncedQuantities: jsonb('synced_quantities').$type<BillingSyncedQuantities>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
