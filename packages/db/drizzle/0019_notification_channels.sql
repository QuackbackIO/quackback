-- Add target_key column to support multi-channel notification routing
ALTER TABLE "integration_event_mappings"
  ADD COLUMN "target_key" varchar(100) NOT NULL DEFAULT 'default';

-- Drop old 3-column unique constraint and replace with 4-column
ALTER TABLE "integration_event_mappings" DROP CONSTRAINT IF EXISTS "mapping_unique";
CREATE UNIQUE INDEX "mapping_unique"
  ON "integration_event_mappings" ("integration_id", "event_type", "action_type", "target_key");

-- Data migration: move channelId from integration-level config into per-mapping targetKey + actionConfig
UPDATE "integration_event_mappings" iem
SET "target_key" = (i."config"->>'channelId'),
    "action_config" = jsonb_set(COALESCE(iem."action_config", '{}'), '{channelId}', to_jsonb(i."config"->>'channelId'))
FROM "integrations" i
WHERE iem."integration_id" = i."id"
  AND i."config"->>'channelId' IS NOT NULL
  AND iem."target_key" = 'default';
