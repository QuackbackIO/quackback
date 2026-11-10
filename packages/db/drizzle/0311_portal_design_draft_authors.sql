-- @contract: additive
-- Who made each change a portal design draft holds: the draft's changed
-- fields, by dotted path, to the principal who changed each one last, or to
-- Quackback AI on that principal's behalf. Cleared with the draft.
ALTER TABLE "portal_designs" ADD COLUMN IF NOT EXISTS "draft_authors" jsonb;
