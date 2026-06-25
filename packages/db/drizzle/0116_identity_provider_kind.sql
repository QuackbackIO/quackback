-- Persist the admin's IdP "shortcut" choice (Okta / Auth0 / Microsoft Entra /
-- Keycloak / Google / Other) on the provider row, so the settings editor and
-- provider list always render the selected provider instead of re-inferring it
-- from the discovery URL. Inference is lossy: a vanity IdP domain (e.g. Okta at
-- login.acme.com) matches none of the URL patterns and would render as "Custom
-- OIDC" after a reload.
--
-- Nullable, no backfill: pre-existing rows keep NULL and the UI falls back to
-- URL inference (today's behaviour) until the provider is next saved.
ALTER TABLE "identity_provider" ADD COLUMN "kind" text;
