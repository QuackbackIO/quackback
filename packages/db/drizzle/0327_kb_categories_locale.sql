-- @contract: additive
-- The language of a help center collection's own name and description. A
-- collection whose main-language version moved to another language keeps
-- the language its text is in, so a reader sees that language named next to
-- it. Until now a collection row held only main-language text, so every
-- existing collection is labelled with the workspace's main language: the
-- one in settings.language_config, else the help center's default language,
-- else English. A value that does not read as a supported language falls
-- through to the next, and settings that are not valid JSON count as unset.
-- @replay: guarded-by kb_categories.locale not existing yet; once it exists the whole block is skipped
DO $$
DECLARE
  main_language text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'kb_categories'::regclass
      AND attname = 'locale'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE "kb_categories" ADD COLUMN "locale" text NOT NULL DEFAULT 'en';
    BEGIN
      SELECT lower(language_config::jsonb ->> 'mainLanguage') INTO main_language
      FROM "settings" LIMIT 1;
    EXCEPTION WHEN others THEN
      main_language := NULL;
    END;
    IF main_language IS NULL OR main_language NOT IN (
      'en', 'de', 'fr', 'es', 'ar', 'ru', 'pt-br', 'zh-cn', 'zh-tw', 'nl', 'pl', 'th', 'uk'
    ) THEN
      BEGIN
        SELECT lower(help_center_config::jsonb -> 'locales' ->> 'default') INTO main_language
        FROM "settings" LIMIT 1;
      EXCEPTION WHEN others THEN
        main_language := NULL;
      END;
    END IF;
    IF main_language IN (
      'de', 'fr', 'es', 'ar', 'ru', 'pt-br', 'zh-cn', 'zh-tw', 'nl', 'pl', 'th', 'uk'
    ) THEN
      UPDATE "kb_categories" SET "locale" = main_language;
    END IF;
  END IF;
END $$;
