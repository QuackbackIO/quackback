-- Add favicon and custom CSS columns to organization table
ALTER TABLE "organization" ADD COLUMN "favicon_blob" bytea;
ALTER TABLE "organization" ADD COLUMN "favicon_type" text;
ALTER TABLE "organization" ADD COLUMN "custom_css" text;
