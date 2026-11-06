-- @contract: additive
-- The Approvals queue is gone. Clear what it left behind in live workspaces:
-- unread approval bells that now open nothing, and webhook and app
-- subscriptions to approval.* events that no longer exist (they also block
-- saving a webhook, since its events must all be known). 0307 drops the bell
-- index. Each UPDATE sits in a DO block so a fleet replay is a no-op.

-- @replay: guarded-by archived_at being NULL; a bell it archives is not matched again
DO $$
BEGIN
  UPDATE "in_app_notifications"
  SET "read_at" = coalesce("read_at", now()), "archived_at" = now()
  WHERE "type" = 'approval_requested' AND "archived_at" IS NULL;
END $$;

-- A webhook subscribed only to approval events has nothing left to deliver, so
-- it is switched off as its events are removed.
-- @replay: guarded-by the events still holding an approval event; a webhook it updates holds none and is not matched again
DO $$
BEGIN
  UPDATE "webhooks"
  SET
    "status" = CASE
      WHEN "events" <@ ARRAY['approval.requested', 'approval.decided', 'approval.applied']::text[]
        THEN 'disabled'
      ELSE "status"
    END,
    "events" = array_remove(array_remove(array_remove("events",
      'approval.requested'), 'approval.decided'), 'approval.applied')
  WHERE "events" && ARRAY['approval.requested', 'approval.decided', 'approval.applied']::text[];
END $$;

-- @replay: guarded-by the subscriptions still holding an approval event; an app it updates holds none and is not matched again
DO $$
BEGIN
  UPDATE "apps"
  SET "subscribed_event_types" = array_remove(array_remove(array_remove("subscribed_event_types",
    'approval.requested'), 'approval.decided'), 'approval.applied')
  WHERE "subscribed_event_types" && ARRAY['approval.requested', 'approval.decided', 'approval.applied']::text[];
END $$;
