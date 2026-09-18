-- Built-in inactivity defaults: once-per-silence check-in on team-handled
-- threads, and Quinn's follow-up nudge (not an answer) before auto-close.
-- Additive / expand-only.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "inactivity_check_in_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "assistant_involvements" ADD COLUMN IF NOT EXISTS "follow_up_sent_at" timestamptz;

--> statement-breakpoint
-- Initialize ownership exactly once, preserving existing live workflow scopes.
UPDATE settings s SET metadata = jsonb_set(
  COALESCE(NULLIF(s.metadata, '')::jsonb, '{}'::jsonb), '{conversationInactivity}',
  COALESCE(NULLIF(s.metadata, '')::jsonb->'conversationInactivity', '{}'::jsonb) ||
  jsonb_build_object('channels', jsonb_build_object(
    'messenger', CASE WHEN EXISTS (SELECT 1 FROM workflows w WHERE w.status='live' AND w.deleted_at IS NULL AND w.trigger_type='conversation.customer_unresponsive' AND (NOT (w.trigger_settings ? 'channels') OR w.trigger_settings->'channels'='[]'::jsonb OR w.trigger_settings->'channels' ? 'messenger')) THEN 'custom' ELSE 'built_in' END,
    'email', CASE WHEN EXISTS (SELECT 1 FROM workflows w WHERE w.status='live' AND w.deleted_at IS NULL AND w.trigger_type='conversation.customer_unresponsive' AND (NOT (w.trigger_settings ? 'channels') OR w.trigger_settings->'channels'='[]'::jsonb OR w.trigger_settings->'channels' ? 'email')) THEN 'custom' ELSE 'built_in' END
  ))
)::text WHERE NOT (COALESCE(NULLIF(s.metadata, '')::jsonb->'conversationInactivity', '{}'::jsonb) ? 'channels');

--> statement-breakpoint
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS inactivity_owner text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS inactivity_anchor_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS inactivity_retry_at timestamptz;
CREATE INDEX IF NOT EXISTS conversations_inactivity_idx ON conversations(channel, inactivity_owner, inactivity_anchor_at, id) WHERE status = 'open' AND inactivity_anchor_at IS NOT NULL;
--> statement-breakpoint
-- Every public message takes the same conversation lock as lifecycle actions,
-- including inbound email, workflow messages and replies through the API.
CREATE OR REPLACE FUNCTION conversation_inactivity_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE author_type text; assistant_author boolean;
BEGIN
  IF NEW.conversation_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM conversations WHERE id = NEW.conversation_id FOR UPDATE;
  IF NEW.is_internal OR NEW.deleted_at IS NOT NULL OR NEW.sender_type = 'system' THEN RETURN NEW; END IF;
  IF NEW.sender_type = 'visitor' THEN
    UPDATE conversations SET inactivity_anchor_at = NULL, inactivity_check_in_at = NULL, inactivity_retry_at = NULL WHERE id = NEW.conversation_id;
  ELSIF NEW.sender_type = 'agent' THEN
    IF NEW.metadata ? 'inactivity' THEN RETURN NEW; END IF;
    SELECT type, service_metadata->>'integrationType' = 'assistant' INTO author_type, assistant_author FROM principal WHERE id = NEW.principal_id;
    IF assistant_author THEN
      IF NEW.metadata ? 'block' THEN RETURN NEW; END IF;
      UPDATE conversations SET inactivity_owner = CASE WHEN NEW.metadata->>'assistantResponseKind' = 'handoff' THEN 'handoff' WHEN NEW.metadata->>'assistantResponseKind' = 'answer' THEN 'assistant_answered' ELSE 'assistant_waiting' END,
        inactivity_anchor_at = CASE WHEN NEW.metadata->>'assistantResponseKind' = 'handoff' THEN NULL ELSE NEW.created_at END, inactivity_check_in_at = NULL, inactivity_retry_at = NULL WHERE id = NEW.conversation_id;
    ELSIF author_type = 'user' THEN
      UPDATE conversations SET inactivity_owner = 'team', inactivity_anchor_at = NEW.created_at, inactivity_check_in_at = NULL, inactivity_retry_at = NULL WHERE id = NEW.conversation_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversation_inactivity_message BEFORE INSERT ON conversation_messages FOR EACH ROW EXECUTE FUNCTION conversation_inactivity_message();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION conversation_inactivity_wake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('snoozed','closed') AND NEW.status = 'open' AND NEW.waiting_since IS NULL AND NEW.inactivity_owner IN ('team','assistant_answered','assistant_waiting') THEN
    NEW.inactivity_anchor_at = now(); NEW.inactivity_check_in_at = NULL; NEW.inactivity_retry_at = NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversation_inactivity_wake BEFORE UPDATE OF status ON conversations FOR EACH ROW EXECUTE FUNCTION conversation_inactivity_wake();
--> statement-breakpoint
-- Backfill from the last public exchange and actual author, never from the
-- absence of an active involvement. Historical handoffs wait for a human.
WITH last_reply AS (
  SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.created_at, m.sender_type, m.metadata, p.type AS principal_type,
    p.service_metadata->>'integrationType' = 'assistant' AS assistant_author
  FROM conversation_messages m LEFT JOIN principal p ON p.id = m.principal_id
  WHERE m.deleted_at IS NULL AND NOT m.is_internal AND m.sender_type IN ('agent','visitor')
    AND (m.sender_type='visitor' OR NOT COALESCE(m.metadata ? 'inactivity', false))
  ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
), periods AS (
  SELECT m.*, ai.status AS involvement_status, ai.last_assistant_answer_at, ai.ended_at
  FROM last_reply m LEFT JOIN LATERAL (SELECT * FROM assistant_involvements ai WHERE ai.conversation_id=m.conversation_id ORDER BY ai.created_at DESC, ai.id DESC LIMIT 1) ai ON true
)
UPDATE conversations c SET
  inactivity_owner = CASE WHEN p.sender_type='visitor' THEN NULL WHEN p.assistant_author AND p.involvement_status='handed_off' THEN 'handoff' WHEN p.assistant_author AND (p.metadata->>'assistantResponseKind'='answer' OR (NOT COALESCE(p.metadata ? 'assistantResponseKind',false) AND p.last_assistant_answer_at >= p.created_at)) THEN 'assistant_answered' WHEN p.assistant_author THEN 'assistant_waiting' WHEN p.principal_type='user' THEN 'team' ELSE NULL END,
  inactivity_anchor_at = CASE WHEN p.sender_type='visitor' OR (p.assistant_author AND p.involvement_status='handed_off') OR (p.principal_type <> 'user' AND NOT COALESCE(p.assistant_author,false)) THEN NULL WHEN p.assistant_author AND (p.metadata->>'assistantResponseKind'='answer' OR (NOT COALESCE(p.metadata ? 'assistantResponseKind',false) AND p.last_assistant_answer_at >= p.created_at)) THEN GREATEST(p.last_assistant_answer_at, p.created_at) ELSE p.created_at END
FROM periods p WHERE p.conversation_id=c.id AND c.inactivity_owner IS NULL;
