-- AI auto-tagging: a tag carrying an AI prompt declares a matching rule that
-- new posts are evaluated against (post.autotag.ts). Null means the tag never
-- reaches the model — the column itself is the per-tag opt-in.
ALTER TABLE "post_tags" ADD COLUMN IF NOT EXISTS "ai_prompt" text;
