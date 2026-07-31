-- Segment targeting for changelog publish notifications: a non-empty list
-- restricts the subscriber fan-out to principals holding at least one listed
-- segment ([] = broadcast to everyone).
ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "segment_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
