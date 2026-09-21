-- Author edits of a support message. Distinct from updated_at, which also
-- moves on soft-delete and other non-content writes. Null until the first edit;
-- the inbox and the visitor thread render it as a small "(edited)" mark.
ALTER TABLE "conversation_messages" ADD COLUMN "edited_at" timestamp with time zone;
