-- @contract: additive
-- A board an admin has set to read-only: its posts stay visible and nobody can
-- post, vote or comment. Independent of any plan limit.
ALTER TABLE "boards"
  ADD COLUMN IF NOT EXISTS "read_only" boolean NOT NULL DEFAULT false;
