-- Remove dead merge_post suggestion type from feedback_suggestions.
-- Duplicate detection is now handled exclusively by the merge_suggestions table.

-- Delete any existing merge_post rows (they were never shown in the UI)
DELETE FROM "feedback_suggestions" WHERE "suggestion_type" = 'merge_post';

-- Drop the merge-specific unique index
DROP INDEX IF EXISTS "feedback_suggestions_pending_merge_idx";

-- Drop the target_post_id index (column being removed)
DROP INDEX IF EXISTS "feedback_suggestions_target_post_idx";

-- Drop the suggestion_type index (only one type remains)
DROP INDEX IF EXISTS "feedback_suggestions_type_idx";

-- Drop merge_post-only columns
ALTER TABLE "feedback_suggestions" DROP COLUMN IF EXISTS "target_post_id";
ALTER TABLE "feedback_suggestions" DROP COLUMN IF EXISTS "similarity_score";
