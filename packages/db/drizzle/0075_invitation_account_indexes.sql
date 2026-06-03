-- Hot-path indexes for two queries the round-2 review surfaced as
-- doing seq scans / sorted-without-an-index.
--
-- 1. invitation_pending_expires_idx
--    Backs invite-sweep.ts (`WHERE kind IN (...) AND status='pending'
--    AND expires_at < now()`). The existing composite is email-leading,
--    so the planner can't satisfy the kind+status+expires_at predicate.
--    Partial on `status='pending'` keeps the index small — terminal
--    rows dominate the table over time.
CREATE INDEX IF NOT EXISTS "invitation_pending_expires_idx"
  ON "invitation" ("kind", "expires_at")
  WHERE "status" = 'pending';

-- 2. account_userId_createdAt_idx
--    Backs the signup_source segment predicate
--    (`SELECT a.provider_id FROM account a WHERE a.user_id = u.id
--    ORDER BY a.created_at ASC LIMIT 1` — per user, per evaluation).
--    The existing `account(user_id)` index satisfies the WHERE but the
--    ORDER BY + LIMIT 1 still requires a sort over matching rows.
--    Composite lets the LIMIT 1 read straight off the index.
CREATE INDEX IF NOT EXISTS "account_userId_createdAt_idx"
  ON "account" ("user_id", "created_at");
