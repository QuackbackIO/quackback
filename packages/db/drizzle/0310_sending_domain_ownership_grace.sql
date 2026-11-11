-- @contract: additive
-- When a verified sending domain's ownership record was first found missing.
-- The row stays verified for a grace period from this moment, with a warning
-- to the people who manage it, and is demoted if the record is still missing
-- when the period ends. Null while the record is published.
ALTER TABLE "email_sending_domains"
  ADD COLUMN IF NOT EXISTS "ownership_missing_since" timestamptz;
