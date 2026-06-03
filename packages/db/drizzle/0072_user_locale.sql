-- Locale claim from OIDC providers (e.g. "en", "en-US", "fr").
-- Populated by Better Auth's profile mapping when the upstream IdP
-- returns a `locale` claim; otherwise NULL. Used as a built-in segment
-- attribute so admins can target portal users by language without
-- needing a custom attribute import.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "locale" text;
