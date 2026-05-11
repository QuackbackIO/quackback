-- Backfill authConfig.ssoOidc.autoProvisionRole = 'member' for tenants
-- that have JIT enabled but no role configured. Preserves today's
-- behaviour exactly (the hook defaulted to 'member' when the field
-- was absent).
--
-- Tenants with JIT disabled don't get the field — the hook
-- short-circuits on autoCreateUsers=false, so the field is moot.
--
-- Bump auth_config_version so cached Better-Auth instances rebuild.

UPDATE settings
SET
  auth_config = jsonb_set(
    auth_config::jsonb,
    '{ssoOidc,autoProvisionRole}',
    '"member"'::jsonb,
    true
  )::text,
  auth_config_version = auth_config_version + 1
WHERE auth_config IS NOT NULL
  AND auth_config::jsonb ? 'ssoOidc'
  AND (auth_config::jsonb -> 'ssoOidc' ->> 'autoCreateUsers')::boolean = true
  AND NOT (auth_config::jsonb -> 'ssoOidc' ? 'autoProvisionRole');
