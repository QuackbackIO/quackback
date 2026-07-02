-- Nullable post ETA for time-based roadmap columns (roadmap-view alignment R1).
-- Stored as a full timestamp (matches the single-datetime ETA model) and
-- presented at month granularity ("Mar 2027"). Additive + backfill-safe
-- (existing rows get NULL). Partial index only covers posts that carry an ETA.
ALTER TABLE "posts" ADD COLUMN "eta" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "posts_eta_idx" ON "posts" ("eta") WHERE "eta" IS NOT NULL;
