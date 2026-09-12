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

  -- Anonymous users are only ever minted by the widget's lazy anonymous sign-in.
  UPDATE "session" SET "scope" = 'widget'
  WHERE "scope" = 'dashboard'
    AND "user_id" IN (SELECT "id" FROM "user" WHERE "is_anonymous" = true);

  -- Sessions that predate the user's first account were minted before any
  -- credential existed — the preserved session of an anonymous→signup absorb,
  -- whose user.is_anonymous is already false by upgrade time. Conservative by
  -- design: a false positive costs a re-login, a false negative keeps a
  -- widget token dashboard-capable.
  UPDATE "session" AS s SET "scope" = 'widget'
  WHERE s."scope" = 'dashboard'
    AND s."created_at" < (
      SELECT min(a."created_at") FROM account a WHERE a."user_id" = s."user_id"
    );

  UPDATE "session" SET "scope" = 'portal'
  WHERE "scope" <> 'portal'
    AND "id" IN (SELECT "session_id" FROM "widget_origin_session");
END $$;
