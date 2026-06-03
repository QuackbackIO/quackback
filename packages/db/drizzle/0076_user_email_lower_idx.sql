-- Functional b-tree index on LOWER(user.email) for case-insensitive lookups.
--
-- The existing user_email_idx is a partial unique index on raw email.
-- After round-2/3 fixes, several hot-path lookups switched to LOWER(email):
--   - recovery-codes-consume.ts  (break-glass sign-in)
--   - segments/segment.evaluation.ts (email predicates in dynamic rules)
--   - routes/api/widget/identify.ts (case-insensitive customer match)
--
-- Without a functional index those queries plan as a seq scan. Even on
-- moderate user tables (50k+) the per-request cost is noticeable for
-- the recovery flow and the per-evaluation cost for segments runs the
-- whole table on every dynamic-segment cron tick.
--
-- Partial WHERE email IS NOT NULL keeps the index small — anonymous
-- principals and orphaned rows don't bloat it.
CREATE INDEX IF NOT EXISTS "user_email_lower_idx"
  ON "user" (LOWER("email")) WHERE "email" IS NOT NULL;
