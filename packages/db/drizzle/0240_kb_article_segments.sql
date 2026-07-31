-- Per-article segment gate for help-center articles, layered on top of the
-- parent category's gate ([] = everyone). Public read paths hide a restricted
-- article from any visitor who shares none of the listed segments.
ALTER TABLE "kb_articles" ADD COLUMN IF NOT EXISTS "segment_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
