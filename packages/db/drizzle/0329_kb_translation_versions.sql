-- @contract: additive
-- Translation versions for the help center editor.
--
-- kb_articles.text_revision counts changes to the text a translation is made
-- from (title, description, body). It starts at 1 and goes up only when that
-- text changes, so moving an article or changing its audience leaves its
-- translations current.
--
-- kb_article_translations.source_revision is the text_revision the
-- translation was made from; a translation whose source_revision is lower
-- than its article's text_revision needs an update. Existing translations get
-- 1, the revision every existing article starts at, so nothing shows as
-- needing an update after the upgrade. source_text keeps the main text the
-- translation was made from ({title, description, content}), so the editor
-- can show what changed since; it is null for translations made before this
-- migration.
--
-- The pending_* columns hold an AI update waiting for review beside the live
-- text, which readers keep seeing until a person publishes the update.
-- check_result is the outcome of the checks run on the latest AI text of the
-- row: the pending update when there is one, otherwise the AI draft.
ALTER TABLE "kb_articles"
  ADD COLUMN IF NOT EXISTS "text_revision" integer NOT NULL DEFAULT 1;

ALTER TABLE "kb_article_translations"
  ADD COLUMN IF NOT EXISTS "source_revision" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "source_text" jsonb,
  ADD COLUMN IF NOT EXISTS "pending_title" text,
  ADD COLUMN IF NOT EXISTS "pending_description" text,
  ADD COLUMN IF NOT EXISTS "pending_content" text,
  ADD COLUMN IF NOT EXISTS "pending_content_json" jsonb,
  ADD COLUMN IF NOT EXISTS "pending_source_revision" integer,
  ADD COLUMN IF NOT EXISTS "pending_source_text" jsonb,
  ADD COLUMN IF NOT EXISTS "pending_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "check_result" jsonb;
