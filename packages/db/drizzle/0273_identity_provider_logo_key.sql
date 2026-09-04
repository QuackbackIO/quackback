-- Custom OIDC identity providers can carry their own logo, shown on the portal
-- sign-in button and the provider list. S3 storage key, same shape as
-- settings.logo_key. Nullable / expand-only: existing providers fall back to
-- the inferred brand glyph.
ALTER TABLE "identity_provider" ADD COLUMN IF NOT EXISTS "logo_key" text;
