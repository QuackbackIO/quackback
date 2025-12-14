-- Migration: Add header display name column
-- Allows customizing the name shown in the portal header (falls back to organization name)

ALTER TABLE "organization" ADD COLUMN "header_display_name" text;
