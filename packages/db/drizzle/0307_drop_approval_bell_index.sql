-- @contract: safe-after 0.14.1 (the index was added after 0.14.1 and no released version reads it)
-- The Approvals queue is gone, and with it the one unread approval bell per
-- person this index enforced. Kept apart from the data clean-up in 0308 so a
-- replay of the lineage drops it again after 0302 recreates it.
DROP INDEX IF EXISTS "in_app_notifications_unread_approval_idx";
