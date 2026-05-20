-- Add managed_field_paths to settings.
-- Drives the "Grafana-style" declarative-config lock: any dot-path in
-- this list is reconciled from /etc/quackback/config.yaml and rejected
-- by the corresponding UI mutator with 403. Empty array = no lock.
ALTER TABLE "settings"
  ADD COLUMN "managed_field_paths" jsonb NOT NULL DEFAULT '[]'::jsonb;
