-- IF WO-14: external-link presentation cache + provenance, and per-integration
-- health timestamps. All columns are additive and nullable — blind-safe for
-- self-hosters, no backfill.
--
-- Links stay plain entity properties (no behavioral fields): remote_title /
-- remote_state / remote_state_at are a display cache the inbound orchestrator
-- fills from data it already receives; origin + created_by_principal_id record
-- which seam created the link. The integrations columns feed the settings-page
-- health panel (WO-6), since hook_deliveries carries no integration attribution.

ALTER TABLE "post_external_links" ADD COLUMN IF NOT EXISTS "remote_title" text;
ALTER TABLE "post_external_links" ADD COLUMN IF NOT EXISTS "remote_state" varchar(64);
ALTER TABLE "post_external_links" ADD COLUMN IF NOT EXISTS "remote_state_at" timestamptz;
ALTER TABLE "post_external_links" ADD COLUMN IF NOT EXISTS "origin" varchar(20);
ALTER TABLE "post_external_links" ADD COLUMN IF NOT EXISTS "created_by_principal_id" text;

ALTER TABLE "ticket_external_links" ADD COLUMN IF NOT EXISTS "remote_title" text;
ALTER TABLE "ticket_external_links" ADD COLUMN IF NOT EXISTS "remote_state" varchar(64);
ALTER TABLE "ticket_external_links" ADD COLUMN IF NOT EXISTS "remote_state_at" timestamptz;
ALTER TABLE "ticket_external_links" ADD COLUMN IF NOT EXISTS "origin" varchar(20);
ALTER TABLE "ticket_external_links" ADD COLUMN IF NOT EXISTS "created_by_principal_id" text;

-- integrations.last_error / last_error_at already exist (reused for error state);
-- only the inbound/outbound success timestamps are new.
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "last_outbound_at" timestamptz;
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "last_inbound_at" timestamptz;
