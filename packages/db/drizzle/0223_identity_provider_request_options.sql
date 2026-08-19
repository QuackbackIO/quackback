-- Per-provider authorize/token request options.
--
-- The scopes column already exists. These two are its siblings: `prompt` and the
-- token-endpoint authentication method were both fixed in code, and both turned
-- out to be wrong for a real provider — one rejecting `prompt=select_account`
-- outright, and providers existing that accept only HTTP Basic at the token
-- endpoint with no way to tell us so.
--
-- Null means the default in each case, matching how `scopes` already behaves, so
-- no existing row changes behaviour.
ALTER TABLE "identity_provider" ADD COLUMN IF NOT EXISTS "prompt" text;
ALTER TABLE "identity_provider" ADD COLUMN IF NOT EXISTS "token_endpoint_auth_method" text;
