-- Backfill: convert existing official responses into pinned comments
-- before dropping the columns. Uses the official_response_principal_id as
-- the comment author, falling back to the post's own principal_id.
WITH inserted_comments AS (
  INSERT INTO "comments" ("id", "post_id", "principal_id", "content", "is_team_member", "created_at")
  SELECT
    gen_random_uuid(),
    p."id",
    COALESCE(p."official_response_principal_id", p."principal_id"),
    p."official_response",
    true,
    COALESCE(p."official_response_at", p."created_at")
  FROM "posts" p
  WHERE p."official_response" IS NOT NULL
    AND p."pinned_comment_id" IS NULL
  RETURNING "id", "post_id"
)
UPDATE "posts"
SET "pinned_comment_id" = inserted_comments."id",
    "comment_count" = "posts"."comment_count" + 1
FROM inserted_comments
WHERE "posts"."id" = inserted_comments."post_id";
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_official_response_principal_id_principal_id_fk";
--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "official_response";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "official_response_principal_id";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "official_response_at";
