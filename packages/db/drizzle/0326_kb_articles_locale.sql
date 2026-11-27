-- @contract: safe-after 0.16.1 (adds a column with a default, and search_vector is dropped and re-added with the same name and type in one transaction)
-- The language of a help center article in its main version. Until now every
-- main-language article was indexed with English word rules, so a workspace
-- writing in German had its articles stemmed as English. The article records
-- its language (the workspace's main language, 'en' for every existing row:
-- English was the only main language before), and search_vector picks its
-- text-search config from it, the same CASE kb_article_translations uses
-- (localeRegconfigCaseSql in packages/db/src/schema/kb.ts). A generated
-- column's expression cannot be altered in place on every supported Postgres,
-- so the column and its GIN index are rebuilt in one transaction.
ALTER TABLE "kb_articles" ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'en';

-- @replay: guarded-by the column's generation expression already reading locale; once rebuilt, a
-- second run finds it and does nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'kb_articles'::regclass
      AND a.attname = 'search_vector'
      AND pg_get_expr(d.adbin, d.adrelid) LIKE '%CASE locale%'
  ) THEN
    ALTER TABLE "kb_articles" DROP COLUMN IF EXISTS "search_vector";
    ALTER TABLE "kb_articles" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector(CASE locale WHEN 'de' THEN 'german'::regconfig WHEN 'fr' THEN 'french'::regconfig WHEN 'es' THEN 'spanish'::regconfig WHEN 'ar' THEN 'arabic'::regconfig WHEN 'ru' THEN 'russian'::regconfig WHEN 'nl' THEN 'dutch'::regconfig WHEN 'pt-br' THEN 'portuguese'::regconfig WHEN 'zh-cn' THEN 'simple'::regconfig WHEN 'zh-tw' THEN 'simple'::regconfig ELSE 'english'::regconfig END, coalesce(title, '')), 'A') || setweight(to_tsvector(CASE locale WHEN 'de' THEN 'german'::regconfig WHEN 'fr' THEN 'french'::regconfig WHEN 'es' THEN 'spanish'::regconfig WHEN 'ar' THEN 'arabic'::regconfig WHEN 'ru' THEN 'russian'::regconfig WHEN 'nl' THEN 'dutch'::regconfig WHEN 'pt-br' THEN 'portuguese'::regconfig WHEN 'zh-cn' THEN 'simple'::regconfig WHEN 'zh-tw' THEN 'simple'::regconfig ELSE 'english'::regconfig END, coalesce(content, '')), 'B')) STORED;
    CREATE INDEX "kb_articles_search_vector_idx" ON "kb_articles" USING gin ("search_vector");
  END IF;
END $$;
