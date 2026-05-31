-- Post-conversation CSAT rating (1-5) submitted by the visitor, with an
-- optional comment. Nullable until the visitor rates.

ALTER TABLE "conversations" ADD COLUMN "csat_rating" integer;
ALTER TABLE "conversations" ADD COLUMN "csat_comment" text;
ALTER TABLE "conversations" ADD COLUMN "csat_submitted_at" timestamptz;
