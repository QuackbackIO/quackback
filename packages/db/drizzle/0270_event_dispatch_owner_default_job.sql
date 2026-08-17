-- The outbox relay is gone. New events (and any INSERT that relies on the
-- column default) belong to the job path. Leftover unpublished relay-owned
-- rows are converted at job-tier / scheduler start, not by this default.
ALTER TABLE "events" ALTER COLUMN "dispatch_owner" SET DEFAULT 'job';
