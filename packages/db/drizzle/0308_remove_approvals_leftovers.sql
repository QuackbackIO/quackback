-- @contract: additive
-- The Approvals queue is gone. Clear what it left behind in live workspaces:
-- unread approval bells that now open nothing, webhook and app subscriptions
-- to approval.* events that no longer exist (they also block saving a webhook,
-- since its events must all be known). 0307 drops the bell index.
-- Every statement is replay-safe.

UPDATE "in_app_notifications"
SET "read_at" = now(), "archived_at" = now()
WHERE "type" = 'approval_requested' AND "archived_at" IS NULL;

-- A webhook subscribed only to approval events has nothing left to deliver, so
-- it is switched off rather than left with an empty event list.
UPDATE "webhooks"
SET "status" = 'disabled'
WHERE "events" <@ ARRAY['approval.requested', 'approval.decided', 'approval.applied']::text[]
  AND "status" = 'active';

UPDATE "webhooks"
SET "events" = array_remove(array_remove(array_remove("events",
  'approval.requested'), 'approval.decided'), 'approval.applied')
WHERE "events" && ARRAY['approval.requested', 'approval.decided', 'approval.applied']::text[]
  AND NOT "events" <@ ARRAY['approval.requested', 'approval.decided', 'approval.applied']::text[];

UPDATE "apps"
SET "subscribed_event_types" = array_remove(array_remove(array_remove("subscribed_event_types",
  'approval.requested'), 'approval.decided'), 'approval.applied')
WHERE "subscribed_event_types" && ARRAY['approval.requested', 'approval.decided', 'approval.applied']::text[];
