-- Migration: Require authentication for voting and reactions
-- This removes anonymous voting support and makes member_id required

-- ============================================
-- VOTES TABLE
-- ============================================

-- Step 1: Add member_id column as UUID (nullable first for migration)
ALTER TABLE "votes" ADD COLUMN IF NOT EXISTS "member_id" uuid;

-- Step 2: Delete any existing anonymous votes (votes without member_id)
DELETE FROM "votes" WHERE "member_id" IS NULL;

-- Step 3: Make member_id NOT NULL
ALTER TABLE "votes" ALTER COLUMN "member_id" SET NOT NULL;

-- Step 4: Add foreign key if not exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'votes_member_id_member_id_fk'
  ) THEN
    ALTER TABLE "votes" ADD CONSTRAINT "votes_member_id_member_id_fk"
      FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- Step 5: Drop old user_identifier column and its index
DROP INDEX IF EXISTS "votes_unique_idx";
ALTER TABLE "votes" DROP COLUMN IF EXISTS "user_identifier";

-- Step 6: Create new unique index on (post_id, member_id)
CREATE UNIQUE INDEX IF NOT EXISTS "votes_member_post_idx" ON "votes" USING btree ("post_id", "member_id");

-- Step 7: Create index for member lookups
CREATE INDEX IF NOT EXISTS "votes_member_id_idx" ON "votes" USING btree ("member_id");
CREATE INDEX IF NOT EXISTS "votes_member_created_at_idx" ON "votes" USING btree ("member_id", "created_at");

-- ============================================
-- COMMENT_REACTIONS TABLE
-- ============================================

-- Step 1: Add member_id column as UUID (nullable first for migration)
ALTER TABLE "comment_reactions" ADD COLUMN IF NOT EXISTS "member_id" uuid;

-- Step 2: Delete any existing anonymous reactions (reactions without member_id)
DELETE FROM "comment_reactions" WHERE "member_id" IS NULL;

-- Step 3: Make member_id NOT NULL
ALTER TABLE "comment_reactions" ALTER COLUMN "member_id" SET NOT NULL;

-- Step 4: Add foreign key if not exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comment_reactions_member_id_member_id_fk'
  ) THEN
    ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_member_id_member_id_fk"
      FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- Step 5: Drop old user_identifier column and its index
DROP INDEX IF EXISTS "comment_reactions_unique_idx";
ALTER TABLE "comment_reactions" DROP COLUMN IF EXISTS "user_identifier";

-- Step 6: Create new unique index on (comment_id, member_id, emoji)
CREATE UNIQUE INDEX IF NOT EXISTS "comment_reactions_unique_idx" ON "comment_reactions" USING btree ("comment_id", "member_id", "emoji");

-- Step 7: Create index for member lookups
CREATE INDEX IF NOT EXISTS "comment_reactions_member_id_idx" ON "comment_reactions" USING btree ("member_id");
