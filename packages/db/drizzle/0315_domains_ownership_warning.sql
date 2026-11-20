-- @contract: additive
-- Delivery of the warning about a verified domain's missing ownership record,
-- for domains added by name. The ownership watch takes a lease
-- (ownership_warning_claimed_at) before sending and confirms
-- (ownership_warning_sent_at) once the warning went out; a lease that was never
-- confirmed is taken again once it is old. Both are null until then, so a
-- failed delivery is tried again on the next check while the grace period
-- runs, and both are cleared with ownership_missing_since.
ALTER TABLE "domains"
  ADD COLUMN IF NOT EXISTS "ownership_warning_claimed_at" timestamptz;
ALTER TABLE "domains"
  ADD COLUMN IF NOT EXISTS "ownership_warning_sent_at" timestamptz;
