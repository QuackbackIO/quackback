-- Identity provider: the single source of truth for an OIDC IdP.
-- `id` is the internal TypeID FK target (uuid, never in URLs);
-- `registration_id` is the Better-Auth providerId string that drives the
-- OAuth redirect URI + account.provider_id and stays stable across the
-- migration. DDL only — backfill of existing OIDC config lands in 0115.
CREATE TABLE "identity_provider" (
  "id" uuid PRIMARY KEY NOT NULL,
  "registration_id" text NOT NULL,
  "label" text NOT NULL,
  "discovery_url" text,
  "authorization_url" text,
  "token_url" text,
  "user_info_url" text,
  "client_id" text NOT NULL,
  "scopes" text,
  "enabled" boolean NOT NULL DEFAULT false,
  "auto_create_users" boolean NOT NULL DEFAULT true,
  "auto_provision_role" text,
  "attribute_mapping" jsonb,
  "show_button" boolean NOT NULL DEFAULT false,
  "details_changed_at" timestamptz,
  "last_successful_test_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "identity_provider_registration_id_uniq" ON "identity_provider" ("registration_id");
--> statement-breakpoint
ALTER TABLE "sso_verified_domain" ADD COLUMN "provider_id" uuid;
--> statement-breakpoint
ALTER TABLE "sso_verified_domain"
  ADD CONSTRAINT "sso_verified_domain_provider_id_fk"
  FOREIGN KEY ("provider_id") REFERENCES "identity_provider"("id") ON DELETE cascade;
