-- @contract: additive
-- The destinations one integration connection serves (GitHub repositories
-- first), each with its own webhook, encrypted signing secret and health. The
-- connection itself stays one row in "integrations".
--
-- Backfill: every GitHub connection with a repository in config.channelId gets
-- that repository as its first destination, carrying the registered webhook id.
-- SQL cannot encrypt, so the webhook secret stays in config.webhookSecret: the
-- inbound handler verifies with it until the app moves it into the
-- destination's encrypted secrets on the next connect or repair.
-- config.channelId is left in place as the default repository, so an app
-- version that predates this table keeps working unchanged. Replay-safe: the
-- table and indexes are IF NOT EXISTS and the backfill skips what exists.
CREATE TABLE IF NOT EXISTS "integration_destinations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "integration_id" uuid NOT NULL,
  "kind" varchar(32) NOT NULL,
  "external_id" text NOT NULL,
  "external_key" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "secrets" text,
  "external_webhook_id" text,
  "webhook_events" text[],
  "last_error" text,
  "last_error_at" timestamp with time zone,
  "last_inbound_at" timestamp with time zone,
  "last_outbound_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- cascade: a destination means nothing without the connection that serves it.
  CONSTRAINT "integration_destinations_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE cascade
);
--> statement-breakpoint
-- Repository names are case-insensitive on GitHub.
CREATE UNIQUE INDEX IF NOT EXISTS "integration_destinations_external_id_uq" ON "integration_destinations" USING btree ("integration_id", "kind", lower("external_id"));
--> statement-breakpoint
-- The provider's immutable id, once known, names one destination even across renames.
CREATE UNIQUE INDEX IF NOT EXISTS "integration_destinations_external_key_uq" ON "integration_destinations" USING btree ("integration_id", "kind", "external_key") WHERE "external_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_destinations_integration_idx" ON "integration_destinations" USING btree ("integration_id");
--> statement-breakpoint
INSERT INTO "integration_destinations" ("id", "integration_id", "kind", "external_id", "external_webhook_id", "config")
SELECT
  gen_random_uuid(),
  i."id",
  'repo',
  i."config"->>'channelId',
  NULLIF(i."config"->>'externalWebhookId', ''),
  jsonb_build_object(
    'inboundMode',
    CASE WHEN EXISTS (
      SELECT 1 FROM "channel_accounts" ca
      WHERE ca."channel" = 'github' AND ca."role" = 'connection' AND ca."deleted_at" IS NULL
    ) THEN 'conversations' ELSE 'off' END
  )
FROM "integrations" i
WHERE i."integration_type" = 'github' AND position('/' in coalesce(i."config"->>'channelId', '')) > 0
ON CONFLICT DO NOTHING;
