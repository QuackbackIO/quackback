-- @contract: additive
-- What a recorded outbound email was, when that changes how a reply to it is
-- handled. `csat` marks a satisfaction survey: a reply to one is added to its
-- closed conversation without reopening it. Null for every other email.
ALTER TABLE "conversation_outbound_emails" ADD COLUMN IF NOT EXISTS "kind" text;
