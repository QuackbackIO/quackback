ALTER TABLE "kb_categories"
  ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS "allowed_segment_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "allowed_principal_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE "kb_categories"
SET "visibility" = CASE WHEN "is_public" THEN 'public' ELSE 'targeted' END
WHERE "visibility" IS NULL OR "visibility" NOT IN ('public', 'targeted');

DO $$ BEGIN
  ALTER TABLE "kb_categories"
    ADD CONSTRAINT "kb_categories_visibility_check"
    CHECK ("visibility" IN ('public', 'targeted'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "kb_categories_visibility_idx"
  ON "kb_categories" USING btree ("visibility");
