-- Free-text reason on an unhelpful article vote.
--
-- A thumbs-down alone says an article missed, not what it missed. The reason
-- column carries the visitor's own words so whoever maintains the article can
-- read them instead of guessing from a counter.
--
-- Nullable and additive: helpful votes never carry a reason, and an unhelpful
-- voter who says nothing leaves it null, so no existing row changes meaning.
-- The partial index backs the per-article, newest-first admin list, which only
-- ever reads rows that have a reason.
ALTER TABLE "kb_article_feedback" ADD COLUMN IF NOT EXISTS "reason" text;

CREATE INDEX IF NOT EXISTS "kb_article_feedback_reason_idx"
  ON "kb_article_feedback" ("article_id", "created_at")
  WHERE "reason" IS NOT NULL;
