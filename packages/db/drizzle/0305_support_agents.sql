-- @contract: additive
-- Who answers customers. A workspace can let its own AI agent answer
-- conversations instead of the built-in Quackback AI, and both keep working.
--
-- support_agents holds the agents that can answer: the built-in AI as one
-- seeded row, and at most one external agent reached by a signed webhook and
-- answering over the REST API with its own credential. support_agent_turns is
-- one request for an agent to answer a customer message; the row is the lease
-- that makes a late or stale answer harmless. conversations gains the agent
-- that currently answers it, and an involvement can name the agent that
-- engaged it. Null in both columns means the built-in AI or the team, exactly
-- as before.
--
-- Additive and replay-safe: new tables with inline, named foreign keys,
-- nullable columns with no default, IF NOT EXISTS everywhere, and a seed that
-- skips what exists. An older app version ignores all of it.
CREATE TABLE IF NOT EXISTS "support_agents" (
  "id" uuid PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "endpoint_url" text,
  "signing_secret_enc" text,
  "credential_hash" text,
  "credential_prefix" text,
  "principal_id" uuid CONSTRAINT "support_agents_principal_id_principal_id_fk" REFERENCES "principal"("id") ON DELETE set null,
  "reply_deadline_seconds" integer DEFAULT 20 NOT NULL,
  "fallback" text DEFAULT 'team' NOT NULL,
  "last_delivered_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "support_agents_deadline_check" CHECK ("reply_deadline_seconds" BETWEEN 5 AND 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_agents_kind_live_idx" ON "support_agents" ("kind") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_agents_credential_hash_idx" ON "support_agents" ("credential_hash") WHERE "credential_hash" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_agent_turns" (
  "id" uuid PRIMARY KEY NOT NULL,
  "conversation_id" uuid NOT NULL CONSTRAINT "support_agent_turns_conversation_id_conversations_id_fk" REFERENCES "conversations"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL CONSTRAINT "support_agent_turns_agent_id_support_agents_id_fk" REFERENCES "support_agents"("id") ON DELETE cascade,
  "trigger_message_id" uuid CONSTRAINT "support_agent_turns_trigger_message_fk" REFERENCES "conversation_messages"("id") ON DELETE set null,
  "status" text DEFAULT 'requested' NOT NULL,
  "deadline_at" timestamp with time zone NOT NULL,
  "reply_key" text,
  "reply_message_id" uuid,
  "fallback_applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_agent_turns_conversation_idx" ON "support_agent_turns" ("conversation_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_agent_turns_open_deadline_idx" ON "support_agent_turns" ("deadline_at") WHERE "status" = 'requested';
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "controller_agent_id" uuid CONSTRAINT "conversations_controller_agent_id_support_agents_id_fk" REFERENCES "support_agents"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "assistant_involvements" ADD COLUMN IF NOT EXISTS "support_agent_id" uuid CONSTRAINT "assistant_involvements_support_agent_id_support_agents_id_fk" REFERENCES "support_agents"("id") ON DELETE set null;
--> statement-breakpoint
INSERT INTO "support_agents" ("id", "kind", "name")
VALUES (gen_random_uuid(), 'quackback_ai', 'Quackback AI')
ON CONFLICT ("kind") WHERE "deleted_at" IS NULL DO NOTHING;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_agent_turns_one_open_idx" ON "support_agent_turns" ("conversation_id") WHERE "status" = 'requested';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_agent_turns_trigger_idx" ON "support_agent_turns" ("conversation_id", "trigger_message_id") WHERE "trigger_message_id" IS NOT NULL;
