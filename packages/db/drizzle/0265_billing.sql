-- Self-serve billing: subscription state, webhook idempotency, usage ledger,
-- and an optimistic-concurrency token for the two writers of settings.cloud.
--
-- Expand-only. Every statement is additive:
--   * the new column is NOT NULL with a default, so code that predates this
--     migration keeps inserting settings rows without naming it;
--   * the new tables are unreferenced by any older code version.
-- Nothing is dropped, renamed, retyped, or tightened, so a fleet running one
-- code version across two schema versions is unaffected either way: old code
-- never reads these, new code reads a column that already exists because this
-- migration lands before the release that reads it.
--
-- Inert without configuration. No billing provider configured means nothing
-- ever writes these tables and `cloud_revision` simply stays 0.

-- ---------------------------------------------------------------------------
-- settings.cloud_revision
-- ---------------------------------------------------------------------------
-- Bumped on every settings.cloud write. Exists because settings.cloud is a
-- read-modify-write JSON block with two writers (the declarative config file's
-- reconciler and the billing module); without a token, the later of two
-- interleaved writers silently erases the earlier one. Mirrors the existing
-- settings.assistant_config_revision.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloud_revision" integer DEFAULT 0 NOT NULL;

-- ---------------------------------------------------------------------------
-- billing_webhook_events — the idempotency ledger
-- ---------------------------------------------------------------------------
-- Keyed by the provider's own event id, so a redelivery is a primary-key
-- conflict rather than a second state transition.
CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
  "provider_event_id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "event_type" text NOT NULL,
  "provider_created_at" timestamp with time zone,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "last_error" text
);

CREATE INDEX IF NOT EXISTS "billing_webhook_events_received_at_idx"
  ON "billing_webhook_events" ("received_at");

-- ---------------------------------------------------------------------------
-- billing_usage_events — the usage ledger
-- ---------------------------------------------------------------------------
-- One row per billable unit, derived from product data. (meter, source_id) is
-- unique so both the derivation sweep and the provider push are safe to
-- re-run: one resolved conversation bills once, forever, even if the product
-- later reopens and re-resolves it.
CREATE TABLE IF NOT EXISTS "billing_usage_events" (
  -- uuid, not text: typeIdWithDefault() stores the TypeID as a native UUID and
  -- converts at the ORM boundary. source_id below is deliberately text — it
  -- holds the TypeID string, so one ledger can carry ids from several tables
  -- as meters are added.
  "id" uuid PRIMARY KEY NOT NULL,
  "meter" text NOT NULL,
  "source_id" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "reported_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_usage_events_meter_source_key"
  ON "billing_usage_events" ("meter", "source_id");

CREATE INDEX IF NOT EXISTS "billing_usage_events_unreported_idx"
  ON "billing_usage_events" ("reported_at", "occurred_at");

-- ---------------------------------------------------------------------------
-- billing_subscription_state — the provider-side mirror
-- ---------------------------------------------------------------------------
-- Not a second source of truth for plan or entitlements (those stay in
-- settings.cloud). Carries only what the provider relationship needs:
-- snapshot_fetched_at is the out-of-order guard, and synced_quantities keeps
-- an unchanged seat count from re-pushing on every reconcile tick.
CREATE TABLE IF NOT EXISTS "billing_subscription_state" (
  "subscription_ref" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "customer_ref" text NOT NULL,
  "snapshot_fetched_at" timestamp with time zone NOT NULL,
  "synced_quantities" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
