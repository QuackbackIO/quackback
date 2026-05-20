-- Add state column to settings.
-- Trinary workspace state: 'active' | 'suspended' | 'deleting'.
-- Written by the declarative config-file reconciler when spec.state is
-- set; defaults to 'active' when no config file is present.
ALTER TABLE "settings"
  ADD COLUMN "state" text NOT NULL DEFAULT 'active';
