-- Maintenance started_at now records when a window actually started. Until
-- now it was stamped when the window was created, so a window scheduled for
-- next week said "Started <today>" and history dated it by creation. The app
-- now writes the planned start while a window is still scheduled and the real
-- start when it begins (automatically, "Start now", or a posted update).
--
-- Existing rows are corrected from the best record there is:
--   1. A window that has begun has a timeline row for it: automatic and
--      manual starts both post an in_progress update, and a window can also
--      move straight to verifying or completed. The first such update is
--      when it really started, early starts by hand included.
--   2. A window with no such update (still scheduled) takes its planned
--      start, matching what the app now writes for scheduled windows.
-- Each only moves started_at later, so a row created already under way
-- keeps its creation time. Backfilled rows carry their own historical times
-- and are left alone.
--
-- The UPDATEs sit in a DO block so a fleet replay is a no-op: each leaves
-- started_at equal to the value it compares against, so a second run
-- matches nothing. A bare UPDATE would collapse the gap-heal window.

-- @replay: guarded-by started_at being earlier than the first start update or scheduled_start_at; a row it updates ends equal to that value
DO $$
BEGIN
  UPDATE "status_incidents" AS i
  SET "started_at" = s."first_start"
  FROM (
    SELECT "incident_id", min("created_at") AS "first_start"
    FROM "status_incident_updates"
    WHERE "status" IN ('in_progress', 'verifying', 'completed')
    GROUP BY "incident_id"
  ) AS s
  WHERE i."id" = s."incident_id"
    AND i."kind" = 'maintenance'
    AND i."backfilled" = false
    AND i."started_at" < s."first_start";

  UPDATE "status_incidents" AS i
  SET "started_at" = i."scheduled_start_at"
  WHERE i."kind" = 'maintenance'
    AND i."backfilled" = false
    AND i."scheduled_start_at" IS NOT NULL
    AND i."started_at" < i."scheduled_start_at"
    AND NOT EXISTS (
      SELECT 1 FROM "status_incident_updates" AS u
      WHERE u."incident_id" = i."id"
        AND u."status" IN ('in_progress', 'verifying', 'completed')
    );
END $$;
