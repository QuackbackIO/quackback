-- Post-child object symmetry: votes -> post_votes (posts -> votes). Matches the
-- post-prefixed sibling tables. Metadata-only rename. The `vote` TypeID prefix
-- was later flipped code-only to post_vote with NO stored-id pass (TypeIDs
-- persist as native uuid, so the prefix lives only in the app layer).

ALTER TABLE "votes" RENAME TO "post_votes";
ALTER INDEX "votes_post_id_idx" RENAME TO "post_votes_post_id_idx";
ALTER INDEX "votes_principal_post_idx" RENAME TO "post_votes_principal_post_idx";
ALTER INDEX "votes_principal_id_idx" RENAME TO "post_votes_principal_id_idx";
ALTER INDEX "votes_principal_created_at_idx" RENAME TO "post_votes_principal_created_at_idx";
ALTER INDEX "votes_source_type_idx" RENAME TO "post_votes_source_type_idx";
