-- Stamp workspaces that never persisted product flags so they match
-- DEFAULT_FEATURE_FLAGS: Feedback + Changelog on; Support, Help Center, and
-- Status off until Settings → General (or an onboarding goal) turns them on.
-- Only null/empty rows are touched; an already-stored Labs blob is left alone.
UPDATE "settings"
SET "feature_flags" = '{"feedback":true,"changelog":true,"helpCenter":false,"supportInbox":false,"supportTickets":false,"statusPage":false}'
WHERE "feature_flags" IS NULL
   OR btrim("feature_flags") IN ('', 'null');
