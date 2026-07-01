-- Post-child object symmetry: comment_edit_history -> post_comment_edit_history
-- (parent chain posts -> comments -> edit history). Metadata-only rename. The
-- `comment_edit` TypeID prefix was later flipped code-only to post_comment_edit
-- with NO stored-id pass (TypeIDs persist as native uuid, prefix is app-layer only).

ALTER TABLE "comment_edit_history" RENAME TO "post_comment_edit_history";
ALTER INDEX "comment_edit_history_comment_id_idx" RENAME TO "post_comment_edit_history_comment_id_idx";
ALTER INDEX "comment_edit_history_created_at_idx" RENAME TO "post_comment_edit_history_created_at_idx";
