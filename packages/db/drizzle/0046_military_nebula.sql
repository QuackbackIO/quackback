-- Drops the dead kb_domain_verifications table (custom help center domains
-- were removed earlier in the branch and the table had no runtime references
-- left).
--
-- This migration also ships alongside a TypeID prefix rename for help center
-- entities (helpcenter_article → article, helpcenter_category → category,
-- helpcenter_feedback → article_feedback). No data rewrite is needed because
-- the DB stores TypeIDs as raw UUIDs — the prefix is only applied when
-- encoding/decoding at the application layer.

DROP TABLE "kb_domain_verifications" CASCADE;
