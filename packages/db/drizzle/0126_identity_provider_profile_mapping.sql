-- Per-provider profile-claim mapping for IdPs whose user info doesn't fit the
-- OIDC defaults (sub/name/email from the id_token or userinfo endpoint).
-- Shape: { source?: 'userinfo' | 'accessTokenJwt', idClaim?, nameClaim?,
-- emailClaim?, emailFallback? } — see IdentityProviderProfileMapping in
-- packages/db/src/schema/auth.ts. Nullable: NULL keeps Better-Auth's default
-- user-info resolution, so existing providers are untouched.
ALTER TABLE "identity_provider" ADD COLUMN "profile_mapping" jsonb;
