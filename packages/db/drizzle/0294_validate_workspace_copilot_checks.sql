-- @contract: safe-after 0.13.2 (validates checks 0292 added NOT VALID; existing rows already satisfy them)
-- Validated in their own migration, after 0292 has committed, so the scan
-- holds only a SHARE UPDATE EXCLUSIVE lock and writes continue.
-- @replay: guarded-by the check already being validated; nothing is scanned on replay
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_messages_parent_check' AND conrelid = 'conversation_messages'::regclass AND NOT convalidated) THEN
    ALTER TABLE "conversation_messages" VALIDATE CONSTRAINT "conversation_messages_parent_check";
  END IF;
END $$;
--> statement-breakpoint
-- @replay: guarded-by the check already being validated; nothing is scanned on replay
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_messages_workspace_internal_check' AND conrelid = 'conversation_messages'::regclass AND NOT convalidated) THEN
    ALTER TABLE "conversation_messages" VALIDATE CONSTRAINT "conversation_messages_workspace_internal_check";
  END IF;
END $$;
