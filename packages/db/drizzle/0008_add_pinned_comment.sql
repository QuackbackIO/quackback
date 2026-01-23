-- Migration: Add pinned comment support
-- This allows pinning a team member's comment as the official response

-- Add pinned_comment_id column to posts table
ALTER TABLE "posts" ADD COLUMN "pinned_comment_id" uuid;--> statement-breakpoint

-- Add index for efficient lookups
CREATE INDEX "posts_pinned_comment_id_idx" ON "posts" ("pinned_comment_id");

-- Note: We intentionally don't add a foreign key constraint here to avoid
-- circular dependency issues. The application layer handles validation.
-- The column references comments.id but we rely on application logic to
-- maintain referential integrity (similar to how parentId works in comments).
