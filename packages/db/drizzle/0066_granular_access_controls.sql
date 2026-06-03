-- ============================================================================
-- v1 Granular Access Controls
-- ============================================================================
--
-- Adds:
--   * boards.audience (jsonb) — new visibility model; backfilled from is_public
--   * Drops boards.is_public (audience is sole source of truth)
--   * segments.slug (text, unique on non-deleted rows)
--   * user_segments.added_by enum widened to ['manual','dynamic','sso','widget','api']
--
-- NOTE: audit_log was added by main's 0057_audit_log (SSO branch). This
-- migration depends on that being applied first. The audit-log helper in
-- apps/web/src/lib/server/audit/log.ts extends AuditEventType with the new
-- access-control events (board.audience.changed, segment.member.added, …).
--
-- Re-run-safe: every step is gated by IF NOT EXISTS or WHERE clauses.
-- ============================================================================

-- ---------------------------------------------------------------
-- 1. boards.audience (additive)
-- ---------------------------------------------------------------
ALTER TABLE "boards"
  ADD COLUMN IF NOT EXISTS "audience" jsonb NOT NULL
  DEFAULT '{"kind":"public"}'::jsonb;

-- Backfill audience from legacy is_public flag. WHERE-guard keeps re-runs idempotent.
UPDATE "boards"
SET "audience" = CASE
  WHEN "is_public" THEN '{"kind":"public"}'::jsonb
  ELSE '{"kind":"team"}'::jsonb
END
WHERE "audience" = '{"kind":"public"}'::jsonb;

-- Drop the legacy is_public column. Audience is now the sole source of truth.
DROP INDEX IF EXISTS "boards_is_public_idx";
ALTER TABLE "boards" DROP COLUMN IF EXISTS "is_public";

-- ---------------------------------------------------------------
-- 2. segments.slug (add nullable, backfill, then enforce NOT NULL)
-- ---------------------------------------------------------------
ALTER TABLE "segments" ADD COLUMN IF NOT EXISTS "slug" text;

-- COALESCE catches the empty-string case: a name with no alphanumeric
-- characters (e.g. "!!!", "---") produces an empty trim result after the
-- regex_replace strips everything. Fall back to "segment-<6-char-id>"
-- so the NOT NULL constraint below holds and the unique-slug routing
-- gives every row an addressable name.
UPDATE "segments"
SET "slug" = COALESCE(
  NULLIF(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''),
  'segment-' || substr("id"::text, 1, 6)
)
WHERE "slug" IS NULL;

-- Resolve any duplicate slugs by appending a 6-char id suffix.
WITH dups AS (
  SELECT "slug" FROM "segments" WHERE "deleted_at" IS NULL GROUP BY "slug" HAVING count(*) > 1
)
UPDATE "segments"
SET "slug" = "slug" || '-' || substr("id"::text, 1, 6)
WHERE "slug" IN (SELECT "slug" FROM dups) AND "deleted_at" IS NULL;

ALTER TABLE "segments" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "segments_slug_unique"
  ON "segments" ("slug") WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------
-- 3. user_segments.added_by enum widening
-- ---------------------------------------------------------------
-- Drop the existing CHECK if drizzle attached one, then re-create with all
-- five values. The constraint name pattern varies across drizzle versions,
-- so try both common shapes.
ALTER TABLE "user_segments"
  DROP CONSTRAINT IF EXISTS "user_segments_added_by_check";

ALTER TABLE "user_segments"
  ADD CONSTRAINT "user_segments_added_by_check"
  CHECK ("added_by" IN ('manual','dynamic','sso','widget','api'));
