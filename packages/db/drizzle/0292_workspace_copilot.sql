-- @contract: safe-after 0.13.2 (the parent check is widened; existing conversation and ticket rows and writers remain valid)
CREATE TABLE IF NOT EXISTS "workspace_assistant_threads" (
  "key" text PRIMARY KEY,
  "owner_principal_id" uuid NOT NULL REFERENCES "principal"("id") ON DELETE CASCADE,
  "title" text NOT NULL DEFAULT '',
  "revision" integer NOT NULL DEFAULT 0,
  "active_run_id" text,
  "lease_token" text,
  "lease_expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_assistant_threads_owner_updated_idx" ON "workspace_assistant_threads" ("owner_principal_id", "updated_at", "key");
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "workspace_thread_key" text REFERENCES "workspace_assistant_threads"("key") ON DELETE CASCADE;
--> statement-breakpoint
-- @replay: guarded-by the parent check already referencing workspace_thread_key; replacement is skipped after its first application
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_messages_parent_check' AND conrelid = 'conversation_messages'::regclass AND pg_get_constraintdef(oid) LIKE '%workspace_thread_key%') THEN
    ALTER TABLE "conversation_messages" DROP CONSTRAINT IF EXISTS "conversation_messages_parent_check";
    ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_parent_check" CHECK (num_nonnulls("conversation_id", "ticket_id", "workspace_thread_key") = 1) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- Validated in its own statement once the check exists.
-- @replay: guarded-by the check already being validated; nothing is scanned on replay
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_messages_parent_check' AND conrelid = 'conversation_messages'::regclass AND NOT convalidated) THEN
    ALTER TABLE "conversation_messages" VALIDATE CONSTRAINT "conversation_messages_parent_check";
  END IF;
END $$;
--> statement-breakpoint
-- @replay: guarded-by the workspace internal check already existing; no constraint is changed on replay
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_messages_workspace_internal_check' AND conrelid = 'conversation_messages'::regclass) THEN
    ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_workspace_internal_check" CHECK ("workspace_thread_key" IS NULL OR "is_internal" = true) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- @replay: guarded-by the check already being validated; nothing is scanned on replay
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_messages_workspace_internal_check' AND conrelid = 'conversation_messages'::regclass AND NOT convalidated) THEN
    ALTER TABLE "conversation_messages" VALIDATE CONSTRAINT "conversation_messages_workspace_internal_check";
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_workspace_created_idx" ON "conversation_messages" ("workspace_thread_key", "created_at", "id") WHERE "workspace_thread_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_messages_workspace_run_sender_idx" ON "conversation_messages" ("workspace_thread_key", ("metadata"->'workspaceTurn'->>'runId'), "sender_type") WHERE "workspace_thread_key" IS NOT NULL;
