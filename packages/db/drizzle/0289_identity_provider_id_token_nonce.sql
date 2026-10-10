-- Per-provider switch for the ID token nonce check. Some OIDC providers sign a
-- valid ID token but never echo the nonce, which fails every sign-in while the
-- check is on. NULL keeps the check; 'off', set by the connection test when the
-- provider leaves the nonce out, sends no nonce and expects none.
-- Nullable / expand-only: existing providers keep the check.
ALTER TABLE "identity_provider" ADD COLUMN IF NOT EXISTS "id_token_nonce" text;
