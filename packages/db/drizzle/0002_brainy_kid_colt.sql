ALTER TABLE "integrations" DROP CONSTRAINT "integrations_integration_type_unique";--> statement-breakpoint
CREATE INDEX "posts_board_deleted_at_idx" ON "posts" USING btree ("board_id","deleted_at");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "vote_count_non_negative" CHECK (vote_count >= 0);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "comment_count_non_negative" CHECK (comment_count >= 0);--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "error_count_non_negative" CHECK (error_count >= 0);--> statement-breakpoint
-- Function to update post comment count
CREATE OR REPLACE FUNCTION update_post_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only count non-deleted comments
    IF NEW.deleted_at IS NULL THEN
      UPDATE posts SET comment_count = comment_count + 1, updated_at = NOW() WHERE id = NEW.post_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Handle soft delete/restore
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      -- Comment was soft-deleted
      UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0), updated_at = NOW() WHERE id = NEW.post_id;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      -- Comment was restored
      UPDATE posts SET comment_count = comment_count + 1, updated_at = NOW() WHERE id = NEW.post_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Only decrement if it wasn't already soft-deleted
    IF OLD.deleted_at IS NULL THEN
      UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0), updated_at = NOW() WHERE id = OLD.post_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- Trigger for comment count updates
DROP TRIGGER IF EXISTS trg_update_post_comment_count ON comments;--> statement-breakpoint
CREATE TRIGGER trg_update_post_comment_count
AFTER INSERT OR UPDATE OF deleted_at OR DELETE ON comments
FOR EACH ROW
EXECUTE FUNCTION update_post_comment_count();