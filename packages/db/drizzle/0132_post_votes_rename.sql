-- Post-child object symmetry: votes -> post_votes (posts -> votes). Matches the
-- post-prefixed sibling tables. Metadata-only rename; the `vote` TypeID prefix is
-- unchanged (later stored-id pass).

ALTER TABLE "votes" RENAME TO "post_votes";
ALTER INDEX "votes_post_id_idx" RENAME TO "post_votes_post_id_idx";
ALTER INDEX "votes_principal_post_idx" RENAME TO "post_votes_principal_post_idx";
ALTER INDEX "votes_principal_id_idx" RENAME TO "post_votes_principal_id_idx";
ALTER INDEX "votes_principal_created_at_idx" RENAME TO "post_votes_principal_created_at_idx";
ALTER INDEX "votes_source_type_idx" RENAME TO "post_votes_source_type_idx";
