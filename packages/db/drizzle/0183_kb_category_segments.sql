-- Help-center category segment gating: restrict a public category (and the
-- articles under it) to members of specific segments. [] = everyone; mirrors
-- changelog_categories.segment_ids and status_components.segment_ids.
ALTER TABLE "kb_categories" ADD COLUMN "segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
