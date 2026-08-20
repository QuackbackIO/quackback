-- Compatibility marker for rolling event dispatch off the outbox relay
-- onto the job_queue. Existing unpublished rows stay relay-owned so an
-- old worker can still drain them. New emits stamp 'job'.
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "dispatch_owner" text NOT NULL DEFAULT 'relay';

-- @replay: guarded-by IF NOT EXISTS on pg_constraint.conname = 'events_dispatch_owner_ck'; the block's
-- only action is adding that constraint, so a second run does nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_dispatch_owner_ck'
  ) THEN
    ALTER TABLE "events"
      ADD CONSTRAINT events_dispatch_owner_ck
      CHECK ("dispatch_owner" IN ('relay', 'job'));
  END IF;
END $$;
