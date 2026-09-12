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
--> statement-breakpoint
-- Rolling deploys: an old replica's identify insert omits scope, so a session
-- minted after the backfill would keep the dashboard default. Provenance is
-- written for every identified session, so re-scope on its insert.
CREATE OR REPLACE FUNCTION quackback_widget_session_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "session" SET "scope" = 'widget'
  WHERE "id" = NEW.session_id AND "scope" = 'dashboard';
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS widget_identified_session_scope ON widget_identified_session;
--> statement-breakpoint
CREATE TRIGGER widget_identified_session_scope
  AFTER INSERT OR UPDATE ON widget_identified_session
  FOR EACH ROW EXECUTE FUNCTION quackback_widget_session_scope();
