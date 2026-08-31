-- Last widget SDK version observed on an external install ping.
-- Nullable: workspaces detected before this column, and npm embeds older than
-- 0.1.6 (no `?sdk=`), have no version. Expand-only.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "widget_installed_sdk_version" text;
