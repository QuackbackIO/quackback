-- @contract: safe-after 0.13.2 (checks are widened; all previously valid rows remain valid)
CREATE TABLE IF NOT EXISTS slack_user_links (
  slack_team_id text NOT NULL,
  slack_user_id text NOT NULL,
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  method text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  suggested_prompts_at timestamptz,
  PRIMARY KEY (slack_team_id, slack_user_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS integration_deliveries (
  provider text NOT NULL,
  delivery_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, delivery_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS integration_deliveries_received_idx ON integration_deliveries(received_at);
--> statement-breakpoint
ALTER TABLE assistant_pending_actions ADD COLUMN IF NOT EXISTS workspace_thread_key text;
--> statement-breakpoint
-- @replay: guarded-by the parent check not yet referencing workspace_thread_key; the replacement is skipped after the first application
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'assistant_pending_actions'::regclass AND conname = 'assistant_pending_actions_parent_check' AND pg_get_constraintdef(oid) LIKE '%workspace_thread_key%') THEN
    ALTER TABLE assistant_pending_actions DROP CONSTRAINT IF EXISTS assistant_pending_actions_parent_check;
    ALTER TABLE assistant_pending_actions ADD CONSTRAINT assistant_pending_actions_parent_check CHECK (num_nonnulls(conversation_id, ticket_id, workspace_thread_key) = 1);
  END IF;
END $$;
--> statement-breakpoint
-- @replay: guarded-by the agent check not yet permitting workspace; the replacement is skipped after the first application
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'assistant_guidance_rules'::regclass AND conname = 'assistant_guidance_rules_agent_check' AND pg_get_constraintdef(oid) LIKE '%workspace%') THEN
    ALTER TABLE assistant_guidance_rules DROP CONSTRAINT IF EXISTS assistant_guidance_rules_agent_check;
    ALTER TABLE assistant_guidance_rules ADD CONSTRAINT assistant_guidance_rules_agent_check CHECK (agent IN ('agent', 'copilot', 'workspace'));
  END IF;
END $$;
--> statement-breakpoint
-- @replay: guarded-by assistant_config version still being 3; version 4 configurations and their revisions are untouched
DO $$ BEGIN
UPDATE settings SET assistant_config = jsonb_set(jsonb_set(assistant_config, '{version}', '4'::jsonb), '{agents,workspace}', '{"capabilities":{"qa":true},"knowledge":{"helpCenter":true,"posts":true,"pastConversations":true,"internalNotes":true,"tickets":true,"changelog":true,"documents":true,"status":true},"toolRules":{},"instructions":"","slack":{"enabled":false,"respondTo":"mentions_and_dms","allowUnlinkedPublicQa":false}}'::jsonb), assistant_config_revision = assistant_config_revision + 1 WHERE assistant_config->>'version' = '3';
END $$;
--> statement-breakpoint
ALTER TABLE settings ALTER COLUMN assistant_config SET DEFAULT '{"version":4,"identity":{"name":"Quinn","avatarUrl":null},"agents":{"agent":{"voice":{"tone":"balanced","responseLength":"balanced","additionalInstructions":""},"knowledge":{"helpCenter":true,"posts":false,"changelog":false,"documents":true,"status":false},"toolRules":{}},"copilot":{"capabilities":{"qa":true},"knowledge":{"helpCenter":true,"posts":true,"pastConversations":true,"internalNotes":true,"tickets":true,"changelog":true,"documents":true,"status":true},"toolRules":{}},"workspace":{"capabilities":{"qa":true},"knowledge":{"helpCenter":true,"posts":true,"pastConversations":true,"internalNotes":true,"tickets":true,"changelog":true,"documents":true,"status":true},"toolRules":{},"instructions":"","slack":{"enabled":false,"respondTo":"mentions_and_dms","allowUnlinkedPublicQa":false}}}}'::jsonb;
