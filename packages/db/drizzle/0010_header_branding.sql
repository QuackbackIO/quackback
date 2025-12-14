-- Add header branding columns to organization table
-- Allows customization of how brand appears in portal navigation header

-- Header logo blob (for custom horizontal wordmark/lockup)
ALTER TABLE "organization" ADD COLUMN "header_logo_blob" bytea;

-- Header logo MIME type (image/png, image/jpeg, image/webp, image/svg+xml)
ALTER TABLE "organization" ADD COLUMN "header_logo_type" text;

-- Header display mode: how the brand appears in the header
-- 'logo_and_name' (default): Square logo + organization name
-- 'logo_only': Just the square logo
-- 'custom_logo': Use the header_logo_blob (horizontal wordmark)
ALTER TABLE "organization" ADD COLUMN "header_display_mode" text DEFAULT 'logo_and_name';
