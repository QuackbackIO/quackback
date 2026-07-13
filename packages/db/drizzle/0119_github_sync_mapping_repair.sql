-- Ensure existing GitHub ticket sync connections have the full outbound event
-- mapping set. Missing `ticket.updated` rows can make description and priority
-- edits appear to save locally while never reaching the GitHub hook.
INSERT INTO "integration_event_mappings" (
  "id",
  "integration_id",
  "event_type",
  "action_type",
  "action_config",
  "filters",
  "target_key",
  "enabled",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  i."id",
  e."event_type",
  'send_message',
  '{}'::jsonb,
  CASE
    WHEN e."is_ticket_event" THEN COALESCE(
      existing_ticket_mapping."filters",
      CASE
        WHEN NULLIF(i."config"->>'defaultInboxId', '') IS NOT NULL
          THEN jsonb_build_object('inboxIds', jsonb_build_array(i."config"->>'defaultInboxId'))
        ELSE NULL
      END
    )
    ELSE NULL
  END,
  'default',
  true,
  now(),
  now()
FROM "integrations" i
LEFT JOIN LATERAL (
  SELECT m."filters"
  FROM "integration_event_mappings" m
  WHERE m."integration_id" = i."id"
    AND m."enabled" = true
    AND m."event_type" IN (
      'ticket.created',
      'ticket.status_changed',
      'ticket.assigned',
      'ticket.updated',
      'ticket.thread_added',
      'ticket.thread_updated',
      'ticket.thread_deleted'
    )
  ORDER BY m."created_at" ASC
  LIMIT 1
) existing_ticket_mapping ON true
CROSS JOIN (
  VALUES
    ('ticket.created', true),
    ('ticket.status_changed', true),
    ('ticket.assigned', true),
    ('ticket.updated', true),
    ('ticket.thread_added', true),
    ('ticket.thread_updated', true),
    ('ticket.thread_deleted', true),
    ('post.created', false)
) AS e("event_type", "is_ticket_event")
WHERE i."integration_type" = 'github'
  AND i."status" = 'active'
  AND COALESCE(i."config"->>'syncDirection', 'outbound') IN ('outbound', 'bidirectional')
ON CONFLICT ("integration_id", "event_type", "action_type", "target_key") DO NOTHING;
