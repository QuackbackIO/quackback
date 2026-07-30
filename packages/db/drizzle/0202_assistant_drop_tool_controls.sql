-- Drop the per-tool control-mode dial from assistant_config.
--   End-user-triggered write tools now execute autonomously (no approval step);
--   there is no admin-configurable approval/autonomous/disabled mode per tool.
--   Strip the stored `toolControls` object from every settings row and the
--   assistant_config column default. The copilot proposal-card flow and the
--   assistant_pending_actions table are unaffected and intentionally kept.
UPDATE settings
SET assistant_config = assistant_config - 'toolControls'
WHERE assistant_config ? 'toolControls';
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "assistant_config" SET DEFAULT '{"version":2,"identity":{"name":"Quinn","avatarUrl":null},"voice":{"tone":"balanced","responseLength":"balanced","additionalInstructions":""}}'::jsonb;
