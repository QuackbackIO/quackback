ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "changelog_visibility_config" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "changelog_segment_visibility" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "segment_id" uuid NOT NULL REFERENCES "segments"("id") ON DELETE CASCADE,
  "restrict_categories" boolean DEFAULT false NOT NULL,
  "allowed_category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "restrict_products" boolean DEFAULT false NOT NULL,
  "allowed_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "changelog_segment_visibility_segment_id_unique" UNIQUE("segment_id")
);
--> statement-breakpoint
DO $$ BEGIN
  -- The CREATE TABLE above already declares this UNIQUE constraint inline, so on
  -- a fresh database the constraint (and its backing index) already exist here.
  -- Re-running ADD CONSTRAINT unconditionally raises 42P07 duplicate_table
  -- ("relation ... already exists") for the backing index — which is NOT a
  -- duplicate_object, so the old EXCEPTION handler did not catch it and the
  -- whole migration aborted on a from-scratch run. Guard on pg_constraint
  -- instead (matching the idempotent pattern in 0124): only ADD the constraint
  -- when the table pre-existed without it (CREATE TABLE IF NOT EXISTS skipped).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.changelog_segment_visibility'::regclass
      AND conname = 'changelog_segment_visibility_segment_id_unique'
  ) THEN
    ALTER TABLE "changelog_segment_visibility"
      ADD CONSTRAINT "changelog_segment_visibility_segment_id_unique"
      UNIQUE ("segment_id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changelog_segment_visibility_segment_id_idx"
  ON "changelog_segment_visibility" USING btree ("segment_id");
