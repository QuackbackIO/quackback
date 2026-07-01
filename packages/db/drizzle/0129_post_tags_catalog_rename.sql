-- Feedback tags: rename the base `tags` catalog to `post_tags`, so both taggable
-- entities share ONE convention: `<entity>_tags` = tag catalog, and
-- `<entity>_tag_assignments` = the tag<->entity junction. Result:
--   posts:         post_tags        + post_tag_assignments
--   conversations: conversation_tags + conversation_tag_assignments
--
-- `post_tags` is free because migration 0128 renamed the old post_tags JOIN to
-- post_tag_assignments. Metadata-only rename; the `tag` TypeID prefix is
-- unchanged (the stored-id prefix flip is a later, separate migration).

ALTER TABLE "tags" RENAME TO "post_tags";
ALTER INDEX "tags_deleted_at_idx" RENAME TO "post_tags_deleted_at_idx";
