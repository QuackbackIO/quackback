-- AI-applied marker on tag assignments: true when the auto-tagging engine
-- (not a human) attached the tag, so admins can review AI-applied tags.
ALTER TABLE "post_tag_assignments" ADD COLUMN "auto_tagged" boolean DEFAULT false NOT NULL;
