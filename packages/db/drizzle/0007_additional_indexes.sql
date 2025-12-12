-- Additional indexes for improved query performance
-- These are lower-priority optimizations identified in the SQL query analysis

-- Composite index for duplicate invitation checks
-- Used when creating invitations to check: org + email + status = 'pending'
CREATE INDEX IF NOT EXISTS "invitation_org_email_status_idx"
  ON "invitation" ("organization_id", "email", "status");

-- Partial index for active (non-muted) subscriber lookups
-- Used when sending notifications to find subscribers who haven't muted
CREATE INDEX IF NOT EXISTS "post_subscriptions_post_active_idx"
  ON "post_subscriptions" ("post_id") WHERE muted = false;

-- Composite index for user activity pages (posts by author)
-- Used in user profile to show posts created by a member, sorted by date
CREATE INDEX IF NOT EXISTS "posts_member_created_at_idx"
  ON "posts" ("member_id", "created_at");

-- Composite index for user activity pages (votes by member)
-- Used in user profile to show voting history, sorted by date
CREATE INDEX IF NOT EXISTS "votes_member_created_at_idx"
  ON "votes" ("member_id", "created_at");
