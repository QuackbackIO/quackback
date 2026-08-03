-- Add portal tab configuration to settings table
ALTER TABLE "settings" ADD COLUMN "portal_tab_config" text;

-- Create portal_tab_segment_overrides table for segment-level tab visibility overrides
CREATE TABLE "portal_tab_segment_overrides" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "segment_id" uuid NOT NULL REFERENCES "segments"("id") ON DELETE CASCADE,
  "overrides" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Create indexes for efficient lookups
CREATE UNIQUE INDEX "portal_tab_segment_overrides_segment_id_idx" ON "portal_tab_segment_overrides"("segment_id");
CREATE INDEX "portal_tab_segment_overrides_created_at_idx" ON "portal_tab_segment_overrides"("created_at");
