-- @contract: additive
-- Delivery of the warning about a verified sending domain's missing ownership
-- record. A check takes a lease (ownership_warning_claimed_at) before sending
-- and confirms (ownership_warning_sent_at) once the warning went out; a lease
-- that was never confirmed is taken again once it is old. Both are null until
-- then, so a failed delivery is tried again on the next check while the grace
-- period runs, and both are cleared with ownership_missing_since.
ALTER TABLE "email_sending_domains"
  ADD COLUMN IF NOT EXISTS "ownership_warning_claimed_at" timestamptz;

-- Rows already inside a grace period were warned when it started, so they are
-- marked delivered as the column is added. Added and filled in one DO block so
-- a replay against a database that already has the column changes nothing,
-- and in particular never marks a warning delivered that is still due.
-- @replay: guarded-by ownership_warning_sent_at not existing yet; once it exists the whole block is skipped
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'email_sending_domains'::regclass
      AND attname = 'ownership_warning_sent_at'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE "email_sending_domains" ADD COLUMN "ownership_warning_sent_at" timestamptz;
    UPDATE "email_sending_domains"
    SET "ownership_warning_sent_at" = "ownership_missing_since"
    WHERE "ownership_missing_since" IS NOT NULL;
  END IF;
END $$;
