-- Schema groundwork + behaviour-preserving backfills for 2FA, SSO
-- verified domains, and auth-config versioning.

-- principal.last_sso_sign_in_at: Read by the SSO-enforcement bootstrap
-- guard. Null = never signed in via SSO.  Written by the
-- /oauth2/callback/:providerId hooks.after middleware on every
-- successful SSO callback that creates a session.
ALTER TABLE "principal" ADD COLUMN "last_sso_sign_in_at" timestamp with time zone;

-- settings.auth_config_version: Monotonic version number bumped on
-- every auth-instance-affecting write. Pods compare cached instance
-- version against this on each request and call resetAuth() on
-- mismatch (defense-in-depth backstop for the Redis pub/sub
-- `auth:config-invalidate` channel). Mutated only via atomic
-- `auth_config_version + 1` to avoid lost updates.
ALTER TABLE "settings" ADD COLUMN "auth_config_version" integer NOT NULL DEFAULT 0;

-- user.two_factor_enabled: per-user flag set by Better-Auth's twoFactor
-- plugin on a successful TOTP verify.
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean NOT NULL DEFAULT false;

-- sso_verified_domain: per-domain SSO verification + per-row `enforced`
-- flag. Replaces the previous single `auth_config.ssoOidc.domain`
-- object + workspace-wide `ssoOidc.enforced` boolean (neither of which
-- ever shipped in a release).
CREATE TABLE "sso_verified_domain" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "verification_token" text NOT NULL,
  "verified_at" timestamptz,
  "enforced" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "sso_verified_domain_name_unique" ON "sso_verified_domain" ("name");

-- two_factor: TOTP shared secret + recovery backup codes (symmetric-
-- encrypted by Better-Auth at write time; we never store plaintext).
-- `verified` defaults true because Better-Auth flips it false only
-- between `/two-factor/enable` and `/two-factor/verify-totp`. Rows
-- that hang around verified=false are abandoned enrolments; the
-- user-facing enable flow re-issues a fresh row each call, so no
-- cleanup job is wired yet.
CREATE TABLE "two_factor" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "secret" text NOT NULL,
  "backup_codes" text NOT NULL,
  "verified" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "two_factor_user_id_idx" ON "two_factor" ("user_id");

-- Backfill last_sso_sign_in_at: any principal whose user has at least
-- one SSO account row gets `now()` so the bootstrap guard's 7-day
-- window passes for them on first deploy. Operators who want stricter
-- behaviour can clear the backfill manually.
UPDATE "principal"
   SET "last_sso_sign_in_at" = now()
 WHERE "user_id" IN (
   SELECT "user_id" FROM "account" WHERE "provider_id" = 'sso'
 );

-- Backfill authConfig.ssoOidc.autoProvisionRole = 'member' for tenants
-- that have JIT enabled but no role configured. Preserves prior
-- behaviour (the hook defaulted to 'member' when the field was absent).
-- Tenants with JIT disabled don't get the field — the hook
-- short-circuits on autoCreateUsers=false, so the field is moot.
UPDATE settings
SET auth_config = jsonb_set(
  auth_config::jsonb,
  '{ssoOidc,autoProvisionRole}',
  '"member"'::jsonb,
  true
)::text
WHERE auth_config IS NOT NULL
  AND auth_config::jsonb ? 'ssoOidc'
  AND (auth_config::jsonb -> 'ssoOidc' ->> 'autoCreateUsers')::boolean = true
  AND NOT (auth_config::jsonb -> 'ssoOidc' ? 'autoProvisionRole');

-- Backfill authConfig.twoFactor.required = false so the new workspace-
-- wide Require 2FA toggle has a defined off state. Hook treats missing
-- `twoFactor` as off so this is behaviour-preserving; the purpose is to
-- make the toggle's stored shape explicit in DB dumps and keep the
-- admin UI rendering the switch reliably without falling back on
-- `undefined`.
UPDATE settings
SET auth_config = jsonb_set(
  auth_config::jsonb,
  '{twoFactor}',
  '{"required":false}'::jsonb,
  true
)::text
WHERE auth_config IS NOT NULL
  AND NOT (auth_config::jsonb ? 'twoFactor');

-- Single bump after the auth-config-affecting writes above so cached
-- Better-Auth instances rebuild on their next request.
UPDATE settings SET auth_config_version = auth_config_version + 1;
