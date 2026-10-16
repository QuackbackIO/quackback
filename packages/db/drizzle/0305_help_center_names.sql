-- @contract: safe-after 0.14.1   (0.14.x reaches the old names through the compatibility views below)
-- Help Center storage drops the old `kb_` naming. Tables, indexes, sequences and
-- constraints move to `help_center_*`; stored AI pipeline steps and event entity
-- types follow the new names. Metadata-only renames plus two small indexed
-- rewrites; TypeIDs persist as native uuid, so no id changes.

-- @replay: guarded-by help_center_articles not existing yet; once the rename has run the block returns without changes
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.help_center_articles') IS NOT NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "kb_categories" RENAME TO "help_center_categories";
  ALTER TABLE "kb_articles" RENAME TO "help_center_articles";
  ALTER TABLE "kb_article_feedback" RENAME TO "help_center_article_feedback";
  ALTER TABLE "kb_search_queries" RENAME TO "help_center_search_queries";
  ALTER TABLE "kb_article_translations" RENAME TO "help_center_article_translations";
  ALTER TABLE "kb_category_translations" RENAME TO "help_center_category_translations";

  -- Renaming a primary-key index also renames its constraint.
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('i', 'S') AND c.relname LIKE 'kb\_%'
  LOOP
    EXECUTE format(
      'ALTER %s %I RENAME TO %I',
      CASE r.relkind WHEN 'i' THEN 'INDEX' ELSE 'SEQUENCE' END,
      r.relname,
      replace(r.relname, 'kb_', 'help_center_')
    );
  END LOOP;

  FOR r IN
    SELECT con.conname, cl.relname AS table_name
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND con.conname LIKE '%kb\_%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
      r.table_name,
      r.conname,
      replace(r.conname, 'kb_', 'help_center_')
    );
  END LOOP;

  -- These generated names would exceed the 63-character identifier limit; the
  -- schema names them explicitly instead.
  ALTER TABLE "help_center_article_feedback"
    RENAME CONSTRAINT "help_center_article_feedback_article_id_help_center_articles_id"
    TO "help_center_article_feedback_article_id_fk";
  ALTER TABLE "help_center_article_translations"
    RENAME CONSTRAINT "help_center_article_translations_article_id_help_center_article"
    TO "help_center_article_translations_article_id_fk";
  ALTER TABLE "help_center_category_translations"
    RENAME CONSTRAINT "help_center_category_translations_category_id_help_center_categ"
    TO "help_center_category_translations_category_id_fk";

  UPDATE "ai_usage_log"
  SET "pipeline_step" = CASE "pipeline_step"
    WHEN 'kb_retrieval_query_embedding' THEN 'help_center_retrieval_query'
    WHEN 'kb_search_query_embedding' THEN 'help_center_search_query'
    WHEN 'kb_article_embedding' THEN 'help_center_article_embedding'
    WHEN 'kb_embedding' THEN 'help_center_embedding'
  END
  WHERE "pipeline_step" IN (
    'kb_retrieval_query_embedding',
    'kb_search_query_embedding',
    'kb_article_embedding',
    'kb_embedding'
  );

  UPDATE "events" SET "entity_type" = 'article' WHERE "entity_type" = 'kb_article';
  UPDATE "events" SET "entity_type" = 'category' WHERE "entity_type" = 'kb_category';
END $$;

-- Expand/contract: the previous release keeps reading and writing the old
-- names during a rolling deploy. Single-table views are automatically
-- updatable and fall back to the base table defaults. Drop them in the next
-- release once no running code uses the old names.
CREATE OR REPLACE VIEW "kb_categories" AS SELECT * FROM "help_center_categories";
CREATE OR REPLACE VIEW "kb_articles" AS SELECT * FROM "help_center_articles";
CREATE OR REPLACE VIEW "kb_article_feedback" AS SELECT * FROM "help_center_article_feedback";
CREATE OR REPLACE VIEW "kb_search_queries" AS SELECT * FROM "help_center_search_queries";
CREATE OR REPLACE VIEW "kb_article_translations" AS SELECT * FROM "help_center_article_translations";
CREATE OR REPLACE VIEW "kb_category_translations" AS SELECT * FROM "help_center_category_translations";
