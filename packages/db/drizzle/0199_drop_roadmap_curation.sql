-- Retire roadmap curation. Roadmap rendering moved to status/ETA-derived views,
-- and the legacy post_roadmaps rows (curated membership, manual position,
-- independent multi-roadmap placement) cannot be mapped to those filters.
--
-- The rows are archived, not dropped: the table is renamed to
-- post_roadmaps_archived and kept as inert data that nothing reads or writes.
-- Its foreign keys are dropped so it never blocks or cascades from deleting a
-- post or a roadmap, and its indexes are renamed so their names stay free. The
-- archive is removed in a later release. An archive with no rows carries
-- nothing worth keeping and is dropped straight away, so a fresh install never
-- has one.
ALTER TABLE IF EXISTS "post_roadmaps" DROP CONSTRAINT IF EXISTS "post_roadmaps_post_id_posts_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "post_roadmaps" DROP CONSTRAINT IF EXISTS "post_roadmaps_roadmap_id_roadmaps_id_fk";
--> statement-breakpoint
ALTER INDEX IF EXISTS "post_roadmaps_pk" RENAME TO "post_roadmaps_archived_pk";
--> statement-breakpoint
ALTER INDEX IF EXISTS "post_roadmaps_post_id_idx" RENAME TO "post_roadmaps_archived_post_id_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "post_roadmaps_roadmap_id_idx" RENAME TO "post_roadmaps_archived_roadmap_id_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "post_roadmaps_position_idx" RENAME TO "post_roadmaps_archived_position_idx";
--> statement-breakpoint
ALTER TABLE IF EXISTS "post_roadmaps" RENAME TO "post_roadmaps_archived";
--> statement-breakpoint
-- @replay: guarded-by the archive existing and holding no rows; a populated archive, or none at all, is left as it is
DO $$
BEGIN
  IF to_regclass('post_roadmaps_archived') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "post_roadmaps_archived") THEN
      DROP TABLE "post_roadmaps_archived";
    END IF;
  END IF;
END $$;
--> statement-breakpoint

-- visibility was backfilled from is_public in migration 0198 and is now the
-- only roadmap visibility source. Remove the dependent index before the column.
DROP INDEX IF EXISTS "roadmaps_is_public_idx";
--> statement-breakpoint
ALTER TABLE "roadmaps" DROP COLUMN IF EXISTS "is_public";
