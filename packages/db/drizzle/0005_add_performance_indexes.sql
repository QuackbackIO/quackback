-- Performance optimization indexes
-- Based on query analysis of common access patterns

-- 1. Posts created_at range queries with board context
-- Optimizes: WHERE board_id = ? AND created_at > ? AND moderation_state = 'published'
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_posts_board_created_moderation"
ON "posts" ("board_id", "created_at", "moderation_state");--> statement-breakpoint

-- 2. Comments member filtering for user activity pages
-- Optimizes: WHERE member_id = ? ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comments_member_created"
ON "comments" ("member_id", "created_at" DESC);--> statement-breakpoint

-- 3. Partial index for posts with embeddings (semantic search optimization)
-- Optimizes: WHERE embedding IS NOT NULL queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_posts_embedding_exists"
ON "posts" ("id")
WHERE "embedding" IS NOT NULL;--> statement-breakpoint

-- 4. Changelog published entries by board
-- Optimizes: WHERE board_id = ? AND published_at IS NOT NULL ORDER BY published_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_changelog_board_published"
ON "changelog_entries" ("board_id", "published_at" DESC)
WHERE "published_at" IS NOT NULL;--> statement-breakpoint

-- 5. Votes duplicate check optimization
-- Optimizes: WHERE member_id = ? AND post_id = ? (check if user voted)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_votes_member_post"
ON "votes" ("member_id", "post_id");--> statement-breakpoint

-- 6. In-app notifications unread count/listing optimization
-- Optimizes: WHERE member_id = ? AND read_at IS NULL ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_notifications_member_unread_created"
ON "in_app_notifications" ("member_id", "created_at" DESC)
WHERE "read_at" IS NULL;--> statement-breakpoint

-- 7. Posts author + status composite for user activity filtering
-- Optimizes: WHERE member_id = ? AND status_id = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_posts_member_status"
ON "posts" ("member_id", "status_id");--> statement-breakpoint

-- 8. Post subscriptions muted filtering
-- Optimizes: WHERE member_id = ? AND muted = false
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_subscriptions_member_muted"
ON "post_subscriptions" ("member_id", "muted");
