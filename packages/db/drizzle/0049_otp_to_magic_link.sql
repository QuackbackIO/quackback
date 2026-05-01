-- Migrate Email-OTP-enabled portals to Magic Link.
--
-- Email OTP is being replaced by Magic Link as the email-based passwordless
-- sign-in method. For any workspace that had `oauth.email = true` in
-- portal_config, this migration sets `oauth.magicLink = true` and
-- `oauth.email = false` so the portal continues offering email-based
-- auth — just via a one-click link instead of a 6-digit code.
--
-- Workspaces with email auth disabled (or no portal_config at all) are
-- unchanged. The portal_config column is text-typed JSON, so we cast
-- through jsonb for the merge and back to text for storage.

UPDATE settings
SET portal_config = (
  (portal_config::jsonb
    || jsonb_build_object(
      'oauth',
      (portal_config::jsonb -> 'oauth')
        || jsonb_build_object(
          'magicLink', true,
          'email', false
        )
    )
  )::text
)
WHERE portal_config IS NOT NULL
  AND (portal_config::jsonb -> 'oauth' ->> 'email') = 'true';
