-- Drop the removed assistant-config fields and per-rule channel targeting.
--   * identity.showAiLabel: the AI label is now always shown, so the stored
--     toggle is dead. Strip it from every settings row and the column default.
--   * channels: per-surface guidance is gone. Strip the object from the
--     assistant_config default + rows, and drop the guidance-rule channel
--     allowlist column (it had no CHECK constraint; renamed from "surfaces").
UPDATE settings
SET assistant_config = jsonb_set(
  assistant_config,
  '{identity}',
  (assistant_config->'identity') - 'showAiLabel'
)
WHERE assistant_config->'identity' ? 'showAiLabel';
--> statement-breakpoint
UPDATE settings
SET assistant_config = assistant_config - 'channels'
WHERE assistant_config ? 'channels';
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "assistant_config" SET DEFAULT '{"version":2,"identity":{"name":"Quinn","avatarUrl":null},"voice":{"tone":"balanced","responseLength":"balanced","additionalInstructions":""},"toolControls":{}}'::jsonb;
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" DROP COLUMN IF EXISTS "channels";
