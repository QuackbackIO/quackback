-- Remove legacy orphan parent references before enforcing the tree invariant.
UPDATE post_comments child
SET parent_id = NULL
WHERE parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM post_comments parent WHERE parent.id = child.parent_id);
--> statement-breakpoint
ALTER TABLE post_comments
  ADD CONSTRAINT post_comments_parent_id_post_comments_id_fk
  FOREIGN KEY (parent_id) REFERENCES post_comments(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE hook_deliveries
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'completed';
