-- Post-child object symmetry: reactions on post comments become
-- post_comment_reactions (parent chain: posts -> comments -> reactions), matching
-- the post-prefixed sibling tables (post_notes, post_roadmaps, post_edit_history).
-- Metadata-only rename. The `reaction` TypeID prefix was later split code-only
-- (post_comment_reaction / conversation_msg_reaction) with NO stored-id pass:
-- TypeIDs persist as native uuid, so the prefix lives only in the app layer.

ALTER TABLE "comment_reactions" RENAME TO "post_comment_reactions";
ALTER INDEX "comment_reactions_comment_id_idx" RENAME TO "post_comment_reactions_comment_id_idx";
ALTER INDEX "comment_reactions_principal_id_idx" RENAME TO "post_comment_reactions_principal_id_idx";
ALTER INDEX "comment_reactions_unique_idx" RENAME TO "post_comment_reactions_unique_idx";
