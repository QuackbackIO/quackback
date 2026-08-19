-- Durable event outbox (EVENTING-V2 §2.5 / WO-1). Every domain mutation writes
-- one row here inside its own transaction; a worker-role relay drains the
-- unpublished rows and fans them out to the existing {event-hooks} queue. This
-- closes the commit-vs-enqueue loss window that fire-and-forget dispatch left
-- open: a crash between DB commit and the Redis enqueue can no longer drop an
-- event, because the event and the mutation commit atomically.
--
-- Single-workspace-per-instance (cloud tenants each run their own instance), so
-- `id` is a plain identity sequence — the global monotonic event order. No
-- snowflake ids, no partitioning.
CREATE TABLE "events" (
	"id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"payload" jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"dedupe_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
-- The app-facing TypeID ('evt_...'), stable across relay attempts so receivers
-- can also deduplicate the narrow crash-after-POST-before-ack window.
CREATE UNIQUE INDEX "events_event_id_idx" ON "events" USING btree ("event_id");
--> statement-breakpoint
-- Hot outbox path: the relay drains only unpublished rows, in id order. The
-- partial predicate keeps this index tiny regardless of total table size, so a
-- 90-day backlog of published rows never slows the drain.
CREATE INDEX "events_unpublished_idx" ON "events" USING btree ("id") WHERE "published_at" IS NULL;
--> statement-breakpoint
-- Per-entity timeline + admin-initiated per-subscription backfill cursors.
CREATE INDEX "events_entity_idx" ON "events" USING btree ("entity_type","entity_id","id");
--> statement-breakpoint
-- "Did X fire?" diagnostics + per-type backfill scans.
CREATE INDEX "events_type_idx" ON "events" USING btree ("type","id");
--> statement-breakpoint
-- Emission-side idempotency: schedulers and retried API handlers supply a
-- dedupe_key so a repeated tick over the same still-qualifying condition writes
-- the event at most once.
CREATE UNIQUE INDEX "events_dedupe_idx" ON "events" USING btree ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;
