-- Remove workspace-wide SSO enforcement keys from auth_config.
--
-- The `ssoOidc.required` and `ssoOidc.allowMagicLinkUnderRequired` fields
-- were the workspace-wide hard-binding switch (force every admin/member
-- through SSO regardless of email domain). Enforcement is now exclusively
-- per-verified-domain via `sso_verified_domain.enforced`, so these keys
-- are inert and we strip them to keep the stored shape honest.
--
-- Bumps auth_config_version on the same statement so cached Better-Auth
-- instances rebuild on their next request without needing a separate
-- config-invalidate pub/sub.

UPDATE settings
SET auth_config = (
  (auth_config::jsonb)
    #- '{ssoOidc,required}'
    #- '{ssoOidc,allowMagicLinkUnderRequired}'
)::text,
    auth_config_version = auth_config_version + 1
WHERE auth_config IS NOT NULL
  AND auth_config::jsonb -> 'ssoOidc' IS NOT NULL
  AND (
    (auth_config::jsonb) -> 'ssoOidc' ? 'required'
    OR (auth_config::jsonb) -> 'ssoOidc' ? 'allowMagicLinkUnderRequired'
  );
