-- @contract: safe-after 0.15.0 (the unique constraints become partial unique indexes over live rows; older code checks deleted rows too, so it never writes a second live row)
-- A deleted board, status or tag no longer holds its slug or name: uniqueness
-- now covers only live rows, so a new board, status or tag (made by hand or by
-- an import) can reuse what a deleted one was called.
ALTER TABLE "boards" DROP CONSTRAINT IF EXISTS "boards_slug_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "boards_slug_unique"
  ON "boards" ("slug") WHERE "deleted_at" IS NULL;

ALTER TABLE "post_statuses" DROP CONSTRAINT IF EXISTS "post_statuses_slug_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "post_statuses_slug_unique"
  ON "post_statuses" ("slug") WHERE "deleted_at" IS NULL;

ALTER TABLE "post_tags" DROP CONSTRAINT IF EXISTS "post_tags_name_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "post_tags_name_unique"
  ON "post_tags" ("name") WHERE "deleted_at" IS NULL;
