-- Promote `vote` to a first-class action in BoardAccess. Existing rows
-- preserve current behavior by copying the `view` tier into the new
-- `vote` slot, and the `segments.view` allowlist into the new
-- `segments.vote` slot — under the old model vote enforcement piggybacked
-- on view + the workspace anonymous-vote kill switch, so "vote = view"
-- is the bug-compatible default. Admins can later diverge them (e.g. set
-- view=anonymous, vote=authenticated for the modern-SaaS "Public" preset).
--
-- The `jsonb_typeof(... = 'array')` guard mirrors migration 0079/0081's
-- defensive shape check: a malformed legacy row (object/string/number
-- where an array was expected) falls back to [] so downstream string[]
-- consumers can't trip on bad shapes.
UPDATE "boards" SET "access" = jsonb_set(
  jsonb_set("access", '{vote}', "access"->'view'),
  '{segments,vote}',
  CASE
    WHEN jsonb_typeof("access"->'segments'->'view') = 'array' THEN "access"->'segments'->'view'
    ELSE '[]'::jsonb
  END
);
--> statement-breakpoint
-- Refresh the column default so newly inserted rows without an explicit
-- `access` value land with the vote slot present (matches
-- DEFAULT_BOARD_ACCESS).
ALTER TABLE "boards" ALTER COLUMN "access" SET DEFAULT '{"view":"anonymous","vote":"anonymous","comment":"anonymous","submit":"anonymous","segments":{"view":[],"vote":[],"comment":[],"submit":[]},"approval":{"posts":false,"comments":false}}'::jsonb;
