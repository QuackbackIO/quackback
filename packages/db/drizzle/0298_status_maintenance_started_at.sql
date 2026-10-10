-- Maintenance started_at now records when a window actually started. Until
-- now it was stamped when the window was created, so a window scheduled for
-- next week said "Started <today>" and history dated it by creation. The app
-- now writes the planned start while a window is still scheduled and the real
-- start when it begins (automatically, "Start now", or a posted update).
--
-- Existing rows take scheduled_start_at wherever started_at is earlier than
-- it, which is exactly the rows stamped at creation ahead of their window. It
-- is the best record of the real start that exists: an automatic start fires
-- at it, and a manual start pulls it to the moment of starting. A row created
-- already under way (scheduled start at or before creation) keeps its
-- creation time, which is when it went live. Backfilled rows carry their own
-- historical times and are left alone.
--
-- The UPDATE sits in a DO block so a fleet replay is a no-op: every row it
-- touches ends with started_at equal to scheduled_start_at, so a second run
-- matches nothing. A bare UPDATE would collapse the gap-heal window.

-- @replay: guarded-by started_at being earlier than scheduled_start_at; a row it updates ends with the two equal
DO $$
BEGIN
  UPDATE "status_incidents"
  SET "started_at" = "scheduled_start_at"
  WHERE "kind" = 'maintenance'
    AND "backfilled" = false
    AND "scheduled_start_at" IS NOT NULL
    AND "started_at" < "scheduled_start_at";
END $$;
