-- Per-teammate language preference (BCP-47 tag, e.g. "en", "fr", "pt-BR").
-- NULL means no preference set; readers fall back to the workspace default.
-- Distinct from `locale` (the IdP-sourced sign-up claim) -- this is a value
-- the teammate sets themselves. No CHECK constraint enumerating languages:
-- P2-D inbox translation needs this open so new languages don't need a
-- migration.
ALTER TABLE "user" ADD COLUMN "preferred_language" text;
