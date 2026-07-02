ALTER TABLE "changelog_entries" ADD COLUMN "notified_at" timestamp with time zone;

-- Backfill: mark already-live entries as notified so the reconciler never
-- re-announces the existing backlog. Scheduled (future) entries stay null and
-- get notified when their publish time arrives.
UPDATE "changelog_entries"
SET "notified_at" = "published_at"
WHERE "published_at" IS NOT NULL AND "published_at" <= now();
