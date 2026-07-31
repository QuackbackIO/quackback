-- Portal social share (OG) image: S3 storage key for a custom og:image on the
-- public portal root. Null falls back to the workspace logo.
ALTER TABLE "settings" ADD COLUMN "portal_og_image_key" text;
