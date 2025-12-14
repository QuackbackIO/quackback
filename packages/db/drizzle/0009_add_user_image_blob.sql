-- Add image_blob and image_type columns to user table if they don't exist
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "image_blob" bytea;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "image_type" text;
