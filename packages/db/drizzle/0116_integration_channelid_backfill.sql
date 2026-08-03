-- Heal integrations whose connect flow historically stored their delivery target
-- under the wrong config key, so getIntegrationTargets() (which reads
-- config.channelId) never resolved a target and silently dropped every event.
-- The save paths are fixed going forward; this backfills already-connected rows.
-- Idempotent: only touches rows that have the source key and lack channelId.

UPDATE "integrations"
SET "config" = "config" || jsonb_build_object('channelId', "config"->>'webhookUrl')
WHERE "integration_type" IN ('n8n', 'make', 'zapier')
  AND "config" ? 'webhookUrl'
  AND NOT ("config" ? 'channelId');

UPDATE "integrations"
SET "config" = "config" || jsonb_build_object('channelId', "config"->>'boardId')
WHERE "integration_type" = 'monday'
  AND "config" ? 'boardId'
  AND NOT ("config" ? 'channelId');
