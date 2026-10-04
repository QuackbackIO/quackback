-- @contract: additive
-- Each teammate owns at most one anonymous customer for testing.
ALTER TABLE "principal" ADD COLUMN IF NOT EXISTS "test_owner_principal_id" uuid
  CONSTRAINT "principal_test_owner_principal_id_principal_id_fk"
  REFERENCES "principal"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "principal_test_owner_idx"
  ON "principal" ("test_owner_principal_id") WHERE "test_owner_principal_id" IS NOT NULL;
