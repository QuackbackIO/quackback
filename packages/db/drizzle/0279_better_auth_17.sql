-- Better Auth 1.7.4 OAuth provider schema (resource model, DPoP / assertion
-- columns, refresh-reuse cache, authorization-code replay) plus jwt() JWKS
-- algorithm columns. Expand-only.
--
-- Account identity is unchanged from 1.6: 1.7.3 restored the
-- (provider_id, account_id) key. Do not add account.issuer.
--
-- Microsoft Entra now keys accounts on the directory `oid` claim instead of
-- pairwise `sub`. When a stored id_token still carries `oid`, rewrite
-- account_id. Collisions (a row already on that oid) are left alone so the
-- unique-looking identity index does not gain a silent duplicate pair.

ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "alg" text;
--> statement-breakpoint
ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "crv" text;
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "client_discovery_id" text;
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "subject_type" text;
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "client_credentials_scopes" text[] DEFAULT ARRAY[]::text[];
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "backchannel_logout_uri" text;
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "backchannel_logout_session_required" boolean;
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "application_type" text;
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "jwks" text;
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "jwks_uri" text;
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "dpop_bound_access_tokens" boolean DEFAULT false;
--> statement-breakpoint
UPDATE "oauth_client"
SET "client_credentials_scopes" = ARRAY[]::text[]
WHERE "client_credentials_scopes" IS NULL;
--> statement-breakpoint
UPDATE "oauth_client"
SET "application_type" = "type"
WHERE "application_type" IS NULL AND "type" IN ('web', 'native');
--> statement-breakpoint
UPDATE "oauth_client"
SET "token_endpoint_auth_method" = 'none'
WHERE "public" IS TRUE
  AND ("token_endpoint_auth_method" IS NULL OR "token_endpoint_auth_method" = '');
--> statement-breakpoint
UPDATE "oauth_client"
SET "grant_types" = ARRAY['authorization_code', 'refresh_token']::text[]
WHERE "grant_types" IS NULL OR cardinality("grant_types") = 0;
--> statement-breakpoint
-- Existing DCR clients stored only the scopes they registered with. Step-up
-- needs the client row to allow the full AS catalogue; the token still only
-- contains scopes the user authorized.
UPDATE "oauth_client"
SET "scopes" = ARRAY(
  SELECT DISTINCT unnest(
    COALESCE("scopes", ARRAY[]::text[]) || ARRAY[
      'openid',
      'profile',
      'email',
      'offline_access',
      'read:feedback',
      'write:feedback',
      'write:changelog',
      'read:article',
      'write:article',
      'read:chat',
      'write:chat'
    ]::text[]
  )
);
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "authorization_code_id" text;
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "resources" text[];
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "requested_user_info_claims" text[];
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "rotated_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "rotation_replay_response" text;
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "rotation_replay_expires_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "confirmation" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_refresh_token_authorization_code_id_idx"
  ON "oauth_refresh_token" ("authorization_code_id");
--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "authorization_code_id" text;
--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "resources" text[];
--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "requested_user_info_claims" text[];
--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "revoked" timestamptz;
--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "confirmation" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_access_token_authorization_code_id_idx"
  ON "oauth_access_token" ("authorization_code_id");
--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN IF NOT EXISTS "resources" text[];
--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN IF NOT EXISTS "requested_user_info_claims" text[];
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_resource" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "name" text NOT NULL,
  "access_token_ttl" integer,
  "refresh_token_ttl" integer,
  "signing_algorithm" text,
  "signing_key_id" text,
  "allowed_scopes" text[],
  "custom_claims" jsonb,
  "dpop_bound_access_tokens_required" boolean DEFAULT false,
  "disabled" boolean DEFAULT false,
  "created_at" timestamptz,
  "updated_at" timestamptz,
  "policy_version" integer DEFAULT 1,
  "metadata" jsonb,
  CONSTRAINT "oauth_resource_identifier_unique" UNIQUE ("identifier")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_client_resource" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "resource_id" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamptz
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oauth_client_resource_client_id_oauth_client_client_id_fk'
  ) THEN
    ALTER TABLE "oauth_client_resource"
      ADD CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fk"
      FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oauth_client_resource_resource_id_oauth_resource_id_fk'
  ) THEN
    ALTER TABLE "oauth_client_resource"
      DROP CONSTRAINT "oauth_client_resource_resource_id_oauth_resource_id_fk";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oauth_client_resource_resource_id_oauth_resource_identifier_fk'
  ) THEN
    ALTER TABLE "oauth_client_resource"
      ADD CONSTRAINT "oauth_client_resource_resource_id_oauth_resource_identifier_fk"
      FOREIGN KEY ("resource_id") REFERENCES "oauth_resource"("identifier") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_client_resource_client_resource_uidx"
  ON "oauth_client_resource" ("client_id", "resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_client_resource_client_id_idx"
  ON "oauth_client_resource" ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_client_resource_resource_id_idx"
  ON "oauth_client_resource" ("resource_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_client_assertion" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
-- Microsoft oid backfill from stored id_tokens (unverified decode of the
-- already-stored JWT payload — the token was verified at sign-in time).
WITH extracted AS (
  SELECT
    "id",
    convert_from(
      decode(
        rpad(
          replace(replace(split_part("id_token", '.', 2), '-', '+'), '_', '/'),
          ((length(replace(replace(split_part("id_token", '.', 2), '-', '+'), '_', '/')) + 3) / 4) * 4,
          '='
        ),
        'base64'
      ),
      'utf8'
    )::jsonb ->> 'oid' AS oid
  FROM "account"
  WHERE "provider_id" = 'microsoft'
    AND "id_token" IS NOT NULL
    AND "id_token" LIKE '%.%.%'
)
UPDATE "account" AS a
SET "account_id" = e.oid
FROM extracted e
WHERE a."id" = e."id"
  AND e.oid IS NOT NULL
  AND e.oid <> ''
  AND a."account_id" IS DISTINCT FROM e.oid
  AND NOT EXISTS (
    SELECT 1 FROM "account" other
    WHERE other."provider_id" = 'microsoft'
      AND other."account_id" = e.oid
      AND other."id" <> a."id"
  );
