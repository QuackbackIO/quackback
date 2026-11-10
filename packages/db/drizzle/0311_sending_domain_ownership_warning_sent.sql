-- @contract: additive
-- When the warning about a verified sending domain's missing ownership record
-- was delivered to the people who manage it. Null until it has been, so a
-- delivery that failed is tried again on the next check while the grace
-- period runs. Cleared with ownership_missing_since.
ALTER TABLE "email_sending_domains"
  ADD COLUMN IF NOT EXISTS "ownership_warning_sent_at" timestamptz;
