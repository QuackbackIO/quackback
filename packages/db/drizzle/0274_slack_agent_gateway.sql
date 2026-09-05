CREATE TABLE slack_user_links (
  slack_team_id text NOT NULL,
  slack_user_id text NOT NULL,
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  method text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  suggested_prompts_at timestamptz,
  PRIMARY KEY (slack_team_id, slack_user_id)
);
--> statement-breakpoint
CREATE TABLE integration_deliveries (
  provider text NOT NULL,
  delivery_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, delivery_id)
);
--> statement-breakpoint
CREATE INDEX integration_deliveries_received_idx ON integration_deliveries(received_at);
--> statement-breakpoint
ALTER TABLE assistant_pending_actions ADD COLUMN workspace_thread_key text;
--> statement-breakpoint
ALTER TABLE assistant_pending_actions DROP CONSTRAINT assistant_pending_actions_parent_check;
--> statement-breakpoint
ALTER TABLE assistant_pending_actions ADD CONSTRAINT assistant_pending_actions_parent_check
  CHECK (num_nonnulls(conversation_id, ticket_id, workspace_thread_key) = 1);
--> statement-breakpoint
ALTER TABLE assistant_guidance_rules DROP CONSTRAINT assistant_guidance_rules_agent_check;
--> statement-breakpoint
ALTER TABLE assistant_guidance_rules ADD CONSTRAINT assistant_guidance_rules_agent_check
  CHECK (agent IN ('agent', 'copilot', 'workspace'));
--> statement-breakpoint
UPDATE settings SET assistant_config = jsonb_set(jsonb_set(assistant_config, '{version}', '4'::jsonb), '{agents,workspace}', '{"capabilities":{"qa":true},"knowledge":{"helpCenter":true,"posts":true,"pastConversations":true,"internalNotes":true,"tickets":true,"changelog":true,"documents":true,"status":true},"toolRules":{},"instructions":"","slack":{"enabled":false,"respondTo":"mentions_and_dms","allowUnlinkedPublicQa":false}}'::jsonb), assistant_config_revision = assistant_config_revision + 1 WHERE assistant_config->>'version' = '3';
--> statement-breakpoint
ALTER TABLE settings ALTER COLUMN assistant_config SET DEFAULT '{"version":4,"identity":{"name":"Quinn","avatarUrl":null},"agents":{"agent":{"voice":{"tone":"balanced","responseLength":"balanced","additionalInstructions":""},"knowledge":{"helpCenter":true,"posts":false,"changelog":false,"documents":true,"status":false},"toolRules":{}},"copilot":{"capabilities":{"qa":true},"knowledge":{"helpCenter":true,"posts":true,"pastConversations":true,"internalNotes":true,"tickets":true,"changelog":true,"documents":true,"status":true},"toolRules":{}},"workspace":{"capabilities":{"qa":true},"knowledge":{"helpCenter":true,"posts":true,"pastConversations":true,"internalNotes":true,"tickets":true,"changelog":true,"documents":true,"status":true},"toolRules":{},"instructions":"","slack":{"enabled":false,"respondTo":"mentions_and_dms","allowUnlinkedPublicQa":false}}}}'::jsonb;
