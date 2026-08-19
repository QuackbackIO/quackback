-- WARNING: LOSSY, IRREVERSIBLE ROADMAP CONVERSION.
-- Phase 2 moved roadmap rendering to status/ETA-derived views, but the legacy
-- post_roadmaps rows cannot be mapped to those filters. Dropping this table
-- permanently discards curated membership, manual position, and independent
-- multi-roadmap placement. Back up post_roadmaps before this migration if that
-- historical data must be retained outside Quackback.
DROP TABLE "post_roadmaps";
--> statement-breakpoint

-- visibility was backfilled from is_public in migration 0198 and is now the
-- only roadmap visibility source. Remove the dependent index before the column.
DROP INDEX "roadmaps_is_public_idx";
--> statement-breakpoint
ALTER TABLE "roadmaps" DROP COLUMN "is_public";
