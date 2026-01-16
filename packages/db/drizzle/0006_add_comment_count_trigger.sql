-- Migration: Add trigger to maintain denormalized comment_count on posts table
-- This trigger automatically updates the comment_count when comments are inserted, deleted, or soft-deleted

-- Function to update comment_count on the parent post
CREATE OR REPLACE FUNCTION update_post_comment_count()
RETURNS TRIGGER AS $$
DECLARE
  target_post_id uuid;
BEGIN
  -- Determine which post_id to update based on operation
  IF TG_OP = 'DELETE' THEN
    target_post_id := OLD.post_id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  -- Update the comment count (only count non-deleted comments)
  UPDATE posts
  SET comment_count = (
    SELECT COUNT(*)
    FROM comments
    WHERE comments.post_id = target_post_id
      AND comments.deleted_at IS NULL
  )
  WHERE id = target_post_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Trigger for INSERT operations
CREATE TRIGGER trg_comment_insert_update_count
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION update_post_comment_count();--> statement-breakpoint

-- Trigger for DELETE operations (hard delete)
CREATE TRIGGER trg_comment_delete_update_count
  AFTER DELETE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION update_post_comment_count();--> statement-breakpoint

-- Trigger for UPDATE operations (handles soft delete via deleted_at)
CREATE TRIGGER trg_comment_update_update_count
  AFTER UPDATE OF deleted_at ON comments
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION update_post_comment_count();--> statement-breakpoint

-- Backfill existing posts with correct comment counts
-- This ensures all existing data is accurate after the trigger is created
UPDATE posts
SET comment_count = (
  SELECT COUNT(*)
  FROM comments
  WHERE comments.post_id = posts.id
    AND comments.deleted_at IS NULL
);
