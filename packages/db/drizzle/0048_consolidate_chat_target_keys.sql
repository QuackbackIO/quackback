-- Consolidate target_key='default' rows for chat integrations.
--
-- Migration 0021 backfilled target_key + action_config.channelId from the
-- integration-level config.channelId. But the legacy updateIntegrationFn
-- omits targetKey on insert, so each event toggle since 0021 ran has
-- created a fresh target_key='default' row for chat integrations,
-- producing duplicates that runtime dedupe collapses but that pollute
-- the table.
--
-- This migration:
--   1. Drops 'default' rows when a real-channel row already exists for
--      the same (integration_id, event_type, action_type) triple.
--   2. Backfills any remaining standalone 'default' rows for chat
--      integrations whose config.channelId is set (same logic as 0021).
--
-- Scope is narrowed to chat integrations (slack, discord, teams). PM
-- integrations (jira, linear, asana, etc.) legitimately use
-- target_key='default' and are left alone.

DELETE FROM integration_event_mappings iem
WHERE iem.target_key = 'default'
  AND iem.integration_id IN (
    SELECT id FROM integrations
    WHERE integration_type IN ('slack', 'discord', 'teams')
  )
  AND EXISTS (
    SELECT 1 FROM integration_event_mappings other
    WHERE other.integration_id = iem.integration_id
      AND other.event_type = iem.event_type
      AND other.action_type = iem.action_type
      AND other.target_key <> 'default'
  );

UPDATE integration_event_mappings iem
SET target_key = (i.config->>'channelId'),
    action_config = jsonb_set(
      COALESCE(iem.action_config, '{}'),
      '{channelId}',
      to_jsonb(i.config->>'channelId')
    )
FROM integrations i
WHERE iem.integration_id = i.id
  AND i.integration_type IN ('slack', 'discord', 'teams')
  AND i.config->>'channelId' IS NOT NULL
  AND iem.target_key = 'default';
