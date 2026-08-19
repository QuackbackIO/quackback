-- Optional hero image for a changelog entry, rendered at the top of the
-- public entry detail page. Null means the entry has no featured image; the
-- value is an uploaded-asset URL (same /api/upload/image pipeline the rich
-- text editor uses, prefix "changelog").
ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "featured_image_url" text;
