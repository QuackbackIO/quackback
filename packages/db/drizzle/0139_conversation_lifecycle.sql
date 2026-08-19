-- Conversation lifecycle break (SUPPORT-PLATFORM-SPEC §4.3): the intermediate
-- status becomes 'snoozed' with an explicit snooze-until, replacing 'pending'.
-- Status is stored as text (the enum is a Drizzle-only constraint, not a PG
-- enum), so the value change is a data UPDATE, not DDL.

-- 1. Retire 'pending' → 'snoozed'. snoozed_until stays NULL, meaning "snoozed
--    until the customer next replies" (a customer message always wakes it).
UPDATE "conversations" SET "status" = 'snoozed' WHERE "status" = 'pending';
--> statement-breakpoint

-- 2. Lifecycle + inbox columns.
--    snoozed_until     : snooze wake time (NULL = until the customer replies).
--    waiting_since     : when the customer started waiting on a reply (NULL = not waiting).
--    source            : inbound source discriminator for the unified inbox (only 'widget' today).
--    custom_attributes : per-conversation extensible metadata (B2B custom fields).
ALTER TABLE "conversations" ADD COLUMN "snoozed_until" timestamptz;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "waiting_since" timestamptz;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "source" text DEFAULT 'widget' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "custom_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

-- 3. Best-effort waiting_since backfill for open threads: the created_at of the
--    oldest customer message with no teammate reply after it. A teammate reply is
--    a non-internal agent message (internal notes are not customer replies and do
--    not bump last_message_at). Resolves to NULL when the newest relevant activity
--    was a teammate reply, i.e. nobody is currently waiting.
UPDATE "conversations" c SET "waiting_since" = (
  SELECT MIN(m."created_at")
  FROM "conversation_messages" m
  WHERE m."conversation_id" = c."id"
    AND m."sender_type" = 'visitor'
    AND m."deleted_at" IS NULL
    AND m."created_at" > COALESCE((
      SELECT MAX(a."created_at")
      FROM "conversation_messages" a
      WHERE a."conversation_id" = c."id"
        AND a."sender_type" = 'agent'
        AND a."is_internal" = false
        AND a."deleted_at" IS NULL
    ), '-infinity'::timestamptz)
)
WHERE c."status" = 'open';
--> statement-breakpoint

-- 4. Keyset-feed index (D17): last activity first with an id tiebreak for the
--    cross-status inbox. DESC is NULLS FIRST by default (matches the TS schema).
CREATE INDEX "conversations_last_message_at_id_idx" ON "conversations" ("last_message_at" DESC, "id");--> statement-breakpoint

-- 5. Trigram search (D17): the inbox visitor-name + message-content search is
--    ILIKE '%term%', which a btree can't serve. GIN trigram indexes make it
--    sargable. These are SQL-only: drizzle-kit cannot express the gin_trgm_ops
--    operator class, so the drift check carries a matching exemption for each.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "conversation_messages_content_trgm_idx" ON "conversation_messages" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "principal_display_name_trgm_idx" ON "principal" USING gin ("display_name" gin_trgm_ops);--> statement-breakpoint

-- 6. Sweeper index: the timer-snooze wake pass scans only rows with a due
--    wake time, so a partial index over just the timer-snoozed rows keeps the
--    sweep cheap as the closed/open backlog grows.
CREATE INDEX IF NOT EXISTS conversations_snoozed_until_idx ON conversations (snoozed_until) WHERE status = 'snoozed' AND snoozed_until IS NOT NULL;
