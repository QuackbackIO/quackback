-- Backfill authConfig.ssoOidc.required=false for tenants that have an
-- ssoOidc block but no required key. Behaviour-preserving: the new
-- isHardBound predicate already treats a missing key as false. The
-- explicit value makes the toggle's stored shape visible in DB dumps
-- and keeps the admin UI rendering the radio without falling back on
-- undefined.
--
-- Bumps auth_config_version on the same statement so cached Better-
-- Auth instances rebuild on their next request without needing a
-- separate config-invalidate pub/sub.
UPDATE settings
SET auth_config = jsonb_set(
  auth_config::jsonb,
  '{ssoOidc,required}',
  'false'::jsonb,
  true
)::text
WHERE auth_config IS NOT NULL
  AND auth_config::jsonb ? 'ssoOidc'
  AND NOT (auth_config::jsonb -> 'ssoOidc' ? 'required');

UPDATE settings SET auth_config_version = auth_config_version + 1;
