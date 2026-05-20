-- SSO recovery codes — break-glass sign-in when SSO is unavailable.
--
-- Each row is a single argon2id-hashed code issued to an admin.
-- `used_at` flips when the code is consumed; a unique partial index
-- on (user_id, code_hash) WHERE used_at IS NULL keeps the active
-- batch collision-free. Regenerating drops the prior rows for the
-- user — see `generateRecoveryCodesFn`.
CREATE TABLE "sso_recovery_code" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "sso_recovery_code_user_id_idx"
  ON "sso_recovery_code" ("user_id");

CREATE UNIQUE INDEX "sso_recovery_code_active_hash_unique"
  ON "sso_recovery_code" ("user_id", "code_hash")
  WHERE "used_at" IS NULL;
