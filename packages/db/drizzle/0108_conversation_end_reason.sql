-- Why a conversation was ended, plus an optional free-text note. Both additive
-- and backfill-safe (existing closed rows get NULL). The reason is a free-text
-- column; the allowed taxonomy is enforced at the app layer (a single source of
-- truth that powers both validation and the end-conversation UI).
--
-- Resolution-rate definition (for later analytics): resolved-rate =
-- count(end_reason IN ('resolved','tracked_as_feedback')) / count(all ended
-- EXCLUDING 'spam'). Spam is dropped from the denominator since it never
-- represented a real request.

ALTER TABLE "conversations" ADD COLUMN "end_reason" text;
ALTER TABLE "conversations" ADD COLUMN "end_note" text;
