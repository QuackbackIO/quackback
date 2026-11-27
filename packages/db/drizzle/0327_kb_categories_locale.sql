-- @contract: additive
-- The language of a help center collection's own name and description. A
-- collection whose main-language version moved to another language keeps
-- the language its text is in, so a reader sees that language named next to
-- it. Every existing collection is in English, the only main language a
-- workspace could have before the language settings.
ALTER TABLE "kb_categories" ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'en';
