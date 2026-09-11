-- Session audience scoping: dashboard | widget | portal. Only dashboard sessions
-- may satisfy team/permission gates. Backfill precedence: portal > widget > dashboard.
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'dashboard' NOT NULL;
--> statement-breakpoint
-- @replay: guarded-by scope predicates; already-marked rows are skipped, so a second run changes nothing
DO $$
BEGIN
  UPDATE "session" SET "scope" = 'widget'
  WHERE "scope" = 'dashboard'
    AND "id" IN (SELECT "session_id" FROM "widget_identified_session");

  UPDATE "session" SET "scope" = 'portal'
  WHERE "scope" <> 'portal'
    AND "id" IN (SELECT "session_id" FROM "widget_origin_session");
END $$;
