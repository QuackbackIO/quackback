-- Feedback tags: rename the post<->tag JOIN from post_tags to
-- post_tag_assignments, matching the `_assignments` junction convention
-- (principal_role_assignments) and the conversation side
-- (conversation_tag_assignments). This removes the ambiguity where `*_tags`
-- meant a JOIN for feedback but a CATALOG for conversations: after this,
-- `*_tags` is always a catalog and `*_tag_assignments` is always the join.
--
-- The `tags` catalog and the `tag` TypeID prefix are unchanged. Metadata-only
-- renames; no row/id rewrite.

ALTER TABLE "post_tags" RENAME TO "post_tag_assignments";
ALTER INDEX "post_tags_pk" RENAME TO "post_tag_assignments_pk";
ALTER INDEX "post_tags_post_id_idx" RENAME TO "post_tag_assignments_post_id_idx";
ALTER INDEX "post_tags_tag_id_idx" RENAME TO "post_tag_assignments_tag_id_idx";
