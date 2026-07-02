-- Existing webhooks subscribed to conversation.csat_submitted used to receive a
-- visitor's CSAT comment through that event: it fired a second time, carrying
-- the comment, on the follow-up POST. The comment now rides its own
-- conversation.csat_comment_added event, so subscribe those webhooks to it too.
-- Without this, consumers that were getting CSAT comments would silently stop
-- after the upgrade.
--
-- Idempotent: skips rows that already list the new event.

UPDATE "webhooks"
SET "events" = array_append("events", 'conversation.csat_comment_added')
WHERE 'conversation.csat_submitted' = ANY("events")
  AND NOT ('conversation.csat_comment_added' = ANY("events"));
