-- @contract: additive
-- Accounts on a provider (GitHub users) matched to teammates, per connection:
-- one GitHub account is the same teammate in every repository the connection
-- serves. Inbound assignee sync reads it to follow an issue's assignee onto
-- its ticket. Keyed by the provider's immutable user id; the login is kept
-- for display and as a fallback, case-insensitively. A new table with no
-- backfill, so older app versions never read it. Replay-safe: every statement
-- is IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS "integration_user_mappings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "integration_id" uuid NOT NULL,
  "external_user_id" text NOT NULL,
  "external_login" text NOT NULL,
  "external_display_name" text,
  "principal_id" uuid NOT NULL,
  "created_by_principal_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- cascade: a mapping means nothing without the connection it belongs to.
  CONSTRAINT "integration_user_mappings_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE cascade,
  -- cascade: a mapping onto a teammate who is gone maps nobody.
  CONSTRAINT "integration_user_mappings_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE cascade,
  CONSTRAINT "integration_user_mappings_created_by_principal_id_fkey" FOREIGN KEY ("created_by_principal_id") REFERENCES "principal"("id") ON DELETE set null
);
--> statement-breakpoint
-- One teammate per account.
CREATE UNIQUE INDEX IF NOT EXISTS "integration_user_mappings_external_user_uq" ON "integration_user_mappings" USING btree ("integration_id", "external_user_id");
--> statement-breakpoint
-- One account per teammate.
CREATE UNIQUE INDEX IF NOT EXISTS "integration_user_mappings_principal_uq" ON "integration_user_mappings" USING btree ("integration_id", "principal_id");
--> statement-breakpoint
-- Logins are case-insensitive on GitHub; the fallback lookup goes by login.
CREATE INDEX IF NOT EXISTS "integration_user_mappings_login_idx" ON "integration_user_mappings" USING btree ("integration_id", lower("external_login"));
