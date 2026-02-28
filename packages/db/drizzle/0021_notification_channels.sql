-- Data migration: move channelId from integration-level config into per-mapping targetKey + actionConfig
-- Note: target_key column and mapping_unique constraint were already added in 0013_keen_iron_monger
UPDATE "integration_event_mappings" iem
SET "target_key" = (i."config"->>'channelId'),
    "action_config" = jsonb_set(COALESCE(iem."action_config", '{}'), '{channelId}', to_jsonb(i."config"->>'channelId'))
FROM "integrations" i
WHERE iem."integration_id" = i."id"
  AND i."config"->>'channelId' IS NOT NULL
  AND iem."target_key" = 'default';
