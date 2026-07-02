DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portal_tab_segment_overrides'
      AND column_name = 'overrides'
      AND data_type <> 'jsonb'
  ) THEN
    ALTER TABLE "portal_tab_segment_overrides"
      ALTER COLUMN "overrides" DROP DEFAULT;

    ALTER TABLE "portal_tab_segment_overrides"
      ALTER COLUMN "overrides" TYPE jsonb USING
        CASE
          WHEN "overrides" IS NULL OR btrim("overrides") = '' THEN '{}'::jsonb
          ELSE "overrides"::jsonb
        END;
  END IF;

  ALTER TABLE "portal_tab_segment_overrides"
    ALTER COLUMN "overrides" SET DEFAULT '{}'::jsonb;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portal_tab_segment_overrides'
      AND column_name = 'created_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "portal_tab_segment_overrides"
      ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portal_tab_segment_overrides'
      AND column_name = 'updated_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "portal_tab_segment_overrides"
      ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.portal_tab_segment_overrides'::regclass
      AND conname = 'portal_tab_segment_overrides_segment_id_unique'
  ) THEN
    ALTER TABLE "portal_tab_segment_overrides"
      ADD CONSTRAINT "portal_tab_segment_overrides_segment_id_unique"
      UNIQUE ("segment_id");
  END IF;
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class idx
    JOIN pg_index ix ON ix.indexrelid = idx.oid
    LEFT JOIN pg_constraint con ON con.conindid = idx.oid
    WHERE idx.relname = 'portal_tab_segment_overrides_segment_id_idx'
      AND ix.indisunique
      AND con.oid IS NULL
  ) THEN
    DROP INDEX "portal_tab_segment_overrides_segment_id_idx";
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_tab_segment_overrides_segment_id_idx"
  ON "portal_tab_segment_overrides" USING btree ("segment_id");
--> statement-breakpoint
DO $$ BEGIN
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
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class idx
    JOIN pg_index ix ON ix.indexrelid = idx.oid
    LEFT JOIN pg_constraint con ON con.conindid = idx.oid
    WHERE idx.relname = 'changelog_segment_visibility_segment_id_idx'
      AND ix.indisunique
      AND con.oid IS NULL
  ) THEN
    DROP INDEX "changelog_segment_visibility_segment_id_idx";
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changelog_segment_visibility_segment_id_idx"
  ON "changelog_segment_visibility" USING btree ("segment_id");