-- Backfill the SSO OIDC config into identity_provider (created in 0114).
-- The SSO path needs no decryption: clientId and discoveryUrl are plaintext on
-- settings.auth_config -> 'ssoOidc'; only the client SECRET lives in the
-- encrypted auth_sso credential blob, which we deliberately leave untouched.
-- registration_id stays 'sso', so existing account.provider_id rows still match
-- their provider -- no account remap. (custom-oidc, whose details are encrypted,
-- is backfilled by an in-process app bootstrap instead.)
--
-- Idempotent: the INSERT is guarded so re-running never creates a second 'sso'
-- provider; the domain re-point only touches still-unlinked rows and preserves
-- each row's `enforced` flag. id has no DB-level default (the TypeID default is
-- applied in the app layer), so we generate a raw uuid -- TypeIDs are stored as
-- uuid, so this is a valid value.

INSERT INTO "identity_provider" (
  "id",
  "registration_id",
  "label",
  "discovery_url",
  "client_id",
  "enabled",
  "auto_create_users",
  "auto_provision_role",
  "attribute_mapping",
  "show_button",
  "details_changed_at",
  "last_successful_test_at"
)
SELECT
  gen_random_uuid(),
  'sso',
  'SSO',
  ("auth_config"::jsonb)->'ssoOidc'->>'discoveryUrl',
  ("auth_config"::jsonb)->'ssoOidc'->>'clientId',
  COALESCE((("auth_config"::jsonb)->'ssoOidc'->>'enabled')::boolean, false),
  COALESCE((("auth_config"::jsonb)->'ssoOidc'->>'autoCreateUsers')::boolean, true),
  ("auth_config"::jsonb)->'ssoOidc'->>'autoProvisionRole',
  ("auth_config"::jsonb)->'ssoOidc'->'attributeMapping',
  false,
  (("auth_config"::jsonb)->'ssoOidc'->>'detailsChangedAt')::timestamptz,
  (("auth_config"::jsonb)->'ssoOidc'->>'lastSuccessfulTestAt')::timestamptz
FROM "settings"
WHERE ("auth_config"::jsonb)->'ssoOidc'->>'discoveryUrl' IS NOT NULL
  AND ("auth_config"::jsonb)->'ssoOidc'->>'clientId' IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "identity_provider" WHERE "registration_id" = 'sso');
--> statement-breakpoint
UPDATE "sso_verified_domain"
SET "provider_id" = (SELECT "id" FROM "identity_provider" WHERE "registration_id" = 'sso')
WHERE "provider_id" IS NULL
  AND EXISTS (SELECT 1 FROM "identity_provider" WHERE "registration_id" = 'sso');
