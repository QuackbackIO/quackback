-- @contract: safe-after 0.13.2 (search_vector is dropped and re-added with the same name and type in one transaction)
-- Dutch help-center search. kb_article_translations.search_vector picks its
-- text-search config per row from a static CASE over locale (0161), which had
-- no 'nl' branch, so Dutch articles were stemmed as English. A generated
-- column's expression cannot be altered in place on every supported Postgres,
-- so the column and its GIN index are rebuilt with the CASE regenerated from
-- LOCALE_TO_REGCONFIG (packages/db/src/schema/kb.ts). The drop and re-add run
-- in one transaction, so running code never sees the column missing.

-- @replay: guarded-by the column's generation expression already naming 'dutch'; once rebuilt, a
-- second run finds it and does nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'kb_article_translations'::regclass
      AND a.attname = 'search_vector'
      AND pg_get_expr(d.adbin, d.adrelid) LIKE '%dutch%'
  ) THEN
    ALTER TABLE "kb_article_translations" DROP COLUMN IF EXISTS "search_vector";
    ALTER TABLE "kb_article_translations" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector(CASE locale WHEN 'de' THEN 'german'::regconfig WHEN 'fr' THEN 'french'::regconfig WHEN 'es' THEN 'spanish'::regconfig WHEN 'ar' THEN 'arabic'::regconfig WHEN 'ru' THEN 'russian'::regconfig WHEN 'nl' THEN 'dutch'::regconfig WHEN 'pt-br' THEN 'portuguese'::regconfig WHEN 'zh-cn' THEN 'simple'::regconfig WHEN 'zh-tw' THEN 'simple'::regconfig ELSE 'english'::regconfig END, coalesce(title, '')), 'A') || setweight(to_tsvector(CASE locale WHEN 'de' THEN 'german'::regconfig WHEN 'fr' THEN 'french'::regconfig WHEN 'es' THEN 'spanish'::regconfig WHEN 'ar' THEN 'arabic'::regconfig WHEN 'ru' THEN 'russian'::regconfig WHEN 'nl' THEN 'dutch'::regconfig WHEN 'pt-br' THEN 'portuguese'::regconfig WHEN 'zh-cn' THEN 'simple'::regconfig WHEN 'zh-tw' THEN 'simple'::regconfig ELSE 'english'::regconfig END, coalesce(content, '')), 'B')) STORED;
    CREATE INDEX "kb_article_translations_search_vector_idx" ON "kb_article_translations" USING gin ("search_vector");
  END IF;
END $$;
