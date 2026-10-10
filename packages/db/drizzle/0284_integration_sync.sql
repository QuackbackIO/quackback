CREATE TABLE IF NOT EXISTS "integration_sync_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation_key" text NOT NULL,
  "integration_id" text NOT NULL,
  "installation" text NOT NULL,
  "provider" text NOT NULL,
  "direction" text NOT NULL,
  "kind" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text NOT NULL,
  "source_revision" text,
  "destination" jsonb NOT NULL,
  "destination_key" text NOT NULL,
  "remote_id" text,
  "state" text DEFAULT 'queued' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "payload" text,
  "result" jsonb,
  "error_code" text,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "dispatched_at" timestamp with time zone,
  "cancel_requested" boolean DEFAULT false NOT NULL,
  "requested_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_sync_operation_key_idx" ON "integration_sync_operations" ("operation_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_sync_history_idx" ON "integration_sync_operations" ("provider", "created_at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_sync_attention_idx" ON "integration_sync_operations" ("integration_id", "installation", "state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_sync_success_idx" ON "integration_sync_operations" ("integration_id", "installation", "direction", "finished_at") WHERE "state" = 'succeeded';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_sync_source_idx" ON "integration_sync_operations" ("source_type", "source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_sync_remote_running_idx" ON "integration_sync_operations" ("installation", "destination_key", "remote_id") WHERE "state" = 'running' AND "remote_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_sync_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation_id" uuid NOT NULL CONSTRAINT "integration_sync_attempt_operation_fk" REFERENCES "integration_sync_operations"("id") ON DELETE CASCADE,
  "number" integer NOT NULL,
  "token" uuid NOT NULL,
  "state" text NOT NULL,
  "error_code" text,
  "result" jsonb,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_sync_attempt_token_idx" ON "integration_sync_attempts" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_sync_attempt_operation_idx" ON "integration_sync_attempts" ("operation_id", "number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_sync_actions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "operation_id" uuid NOT NULL CONSTRAINT "integration_sync_action_operation_fk" REFERENCES "integration_sync_operations"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "principal_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS integration_sync_start (
  id integer PRIMARY KEY NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO integration_sync_start (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- @replay: guarded-by selecting only retired integration event jobs and Slack jobs without a sync operation; new writers never create either shape
DO $$ BEGIN
  DELETE FROM job_queue WHERE
    (queue = 'slack-hook' AND payload->>'operationId' IS NULL) OR
    (queue = 'events' AND (
      payload->'config'->>'integrationId' IS NOT NULL OR
      payload->>'hookType' IN ('slack','discord','linear','jira','github','intercom','teams','zendesk','hubspot','asana','clickup','shortcut','zapier','azure_devops','notion','trello','gitlab','stripe','monday','freshdesk','salesforce','n8n','make','segment','ntfy','remote_status_push')
    ));
  DELETE FROM hook_deliveries WHERE job_id LIKE 'integration-post-created:%';
END $$;
