-- @contract: additive
-- Each teammate owns at most one anonymous customer for testing.
ALTER TABLE "principal" ADD COLUMN IF NOT EXISTS "test_owner_principal_id" uuid
  CONSTRAINT "principal_test_owner_principal_id_principal_id_fk"
  REFERENCES "principal"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "principal_test_owner_idx"
  ON "principal" ("test_owner_principal_id") WHERE "test_owner_principal_id" IS NOT NULL;
--> statement-breakpoint
-- Test threads and ideas are a handful per teammate. The inbox Test count and
-- the 7-day test-data sweep read these sets instead of scanning every row.
CREATE INDEX IF NOT EXISTS "conversations_test_created_at_idx"
  ON "conversations" USING btree ("created_at")
  WHERE coalesce(custom_attributes->>'test', 'false') = 'true';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_test_created_at_idx"
  ON "posts" USING btree ("created_at")
  WHERE coalesce(widget_metadata->>'test', 'false') = 'true';
