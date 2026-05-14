-- Normalize the inert combination `twoFactor.required=true AND
-- oauth.password=false`. The workspace 2FA gate runs exclusively on
-- password and magic-link verify paths (SSO / OAuth provider MFA
-- happens upstream), and enrolling 2FA requires confirming a password.
-- So a workspace with password sign-in disabled cannot actually use
-- 2FA: enrolled users can sign in via magic-link (gated to "use
-- password" but no password exists), unenrolled users can't enroll.
--
-- Existing tenants in this state never had functional 2FA — flipping
-- the stored flag to false is behaviour-preserving and aligns the row
-- with the validator added in settings.service.ts (which now refuses
-- the combination on every write). Bumps auth_config_version so any
-- cached Better-Auth instances on other pods rebuild on their next
-- request.

UPDATE settings
SET auth_config = jsonb_set(
  auth_config::jsonb,
  '{twoFactor,required}',
  'false'::jsonb,
  true
)::text
WHERE auth_config IS NOT NULL
  AND (auth_config::jsonb -> 'twoFactor' ->> 'required') = 'true'
  AND (auth_config::jsonb -> 'oauth' ->> 'password') = 'false';

UPDATE settings SET auth_config_version = auth_config_version + 1
WHERE auth_config IS NOT NULL
  AND (auth_config::jsonb -> 'twoFactor' ->> 'required') = 'false'
  AND (auth_config::jsonb -> 'oauth' ->> 'password') = 'false';
