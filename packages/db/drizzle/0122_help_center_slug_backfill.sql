-- Heal help-center categories/articles whose slug was left empty by the
-- pre-fix create paths for names that slugified to nothing (CJK before
-- transliteration, or emoji-/punctuation-only). An empty slug breaks the
-- NOT NULL unique slug index and the path-param category/article routes
-- (#285). The service paths are fixed going forward; this repairs already
-- broken rows.
--
-- Each slug index is NOT NULL UNIQUE, so at most one row per table can hold
-- ''. The replacement is derived from the (unique) id so it cannot collide.
-- Idempotent: only touches empty slugs.

UPDATE "kb_categories"
SET "slug" = 'category-' || "id"::text
WHERE "slug" = '';

UPDATE "kb_articles"
SET "slug" = 'article-' || "id"::text
WHERE "slug" = '';
