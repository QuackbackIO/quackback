-- Pre-chat email capture: an optional contact address an anonymous visitor
-- provides so the team can follow up offline. Stored per conversation (the
-- visitor principal stays anonymous). Agent-only — never echoed to the visitor
-- channel beyond their own input.

ALTER TABLE "conversations" ADD COLUMN "visitor_email" text;
