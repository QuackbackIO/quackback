-- A fact only the right SECRET_KEY can verify.
--
-- SAAS-HOSTING-STACK.md §4.3 records the failure this exists to prevent, and it
-- is unusual in that the damage is silent and permanent. A wrong SECRET_KEY does
-- not corrupt and does not forge: AES-GCM's auth tag fails to verify, so
-- `decrypt()` throws and sessions fail closed. What it does instead is worse —
-- integration OAuth tokens, webhook signing secrets and custom-action headers
-- become PERMANENTLY UNRECOVERABLE, with no alarm beyond scattered per-call
-- error logs, while the fleet cheerfully writes NEW ciphertext under the wrong
-- key on top.
--
-- Under one process per tenant that could not happen: the key came from the same
-- environment as the database. Pooled, the key is resolved from a reference and
-- the database is resolved from a different field of the same record, and
-- nothing has ever checked that the two agree.
--
-- So the key gets the treatment §3 gives the database. This column holds a
-- constant sealed under the tenant's own SECRET_KEY. On pool checkout — the same
-- pass as the fingerprint, cached per pool — a replica opens it. If it cannot,
-- it refuses to serve the tenant rather than encrypting under a key that will
-- not open tomorrow.
--
-- Sealed rather than hashed on purpose: a hash of the key would be an
-- offline-guessable verifier sitting in a database, while a sealed constant
-- proves possession and publishes nothing.
--
-- Expand-only and nullable. Every self-hosted install has NULL here and always
-- will — the check is claim-based, so it only applies to a record whose
-- `appSecretsRef` says the key is derived. Nothing reads this column until a
-- control plane writes it.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloud_secret_canary" text;

COMMENT ON COLUMN "settings"."cloud_secret_canary" IS
  'A constant sealed under this tenant''s SECRET_KEY, written by the control plane. Checked on pool checkout so a wrong key refuses to serve instead of silently making stored ciphertext unrecoverable. NULL on self-hosted installs.';
