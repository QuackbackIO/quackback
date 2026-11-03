-- @contract: additive
-- Sending domain setup v1: stored MAIL FROM label, automatic check window,
-- and pre-flight results. Existing domains keep the label they were verified
-- with.
ALTER TABLE "email_sending_domains"
  ADD COLUMN IF NOT EXISTS "mail_from_label" text NOT NULL DEFAULT 'bounce',
  ADD COLUMN IF NOT EXISTS "auto_check_until" timestamptz,
  ADD COLUMN IF NOT EXISTS "preflight" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Domains still pending from before the window existed get one from now, so
-- they are checked automatically like a domain added today. The UPDATE sits in
-- a DO block so a fleet replay is a no-op: it fills only NULL windows and
-- leaves none behind, and the app sets the window on every row it creates.
-- @replay: guarded-by auto_check_until being NULL; a row it updates ends with a window and is not matched again
DO $$
BEGIN
  UPDATE "email_sending_domains"
  SET "auto_check_until" = now() + interval '72 hours'
  WHERE "status" = 'pending' AND "auto_check_until" IS NULL;
END $$;
