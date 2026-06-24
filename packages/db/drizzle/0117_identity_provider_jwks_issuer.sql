-- Manual-endpoint OIDC providers (no discovery document) need a JWKS URI and an
-- issuer stored on the row so the SSO test can verify the ID token's signature
-- and its iss/aud claims — exactly what discovery providers resolve from the
-- discovery doc at runtime. Both nullable: discovery providers leave them NULL
-- and resolve these endpoints from `discovery_url` instead.
ALTER TABLE "identity_provider" ADD COLUMN "jwks_uri" text;
ALTER TABLE "identity_provider" ADD COLUMN "issuer" text;
