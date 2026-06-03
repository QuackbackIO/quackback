-- Drop the orphaned per-board moderation column.
--
-- The original 0066 draft added boards.moderation for a per-board moderation
-- policy. That model was dropped in favour of a global (workspace) moderation
-- policy, and 0066 was edited in place to no longer add the column. This
-- migration removes the column from any database that applied the pre-edit
-- 0066. IF EXISTS makes it a harmless no-op on fresh installs that never had
-- the column.
ALTER TABLE "boards" DROP COLUMN IF EXISTS "moderation";
