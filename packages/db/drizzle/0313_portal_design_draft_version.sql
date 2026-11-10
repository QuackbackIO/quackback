-- @contract: additive
-- A count every draft save moves on, so the draft's revision changes with each
-- save, even two in the same millisecond. Never reset: a draft started after a
-- publish or discard carries on from where the last one stopped.
ALTER TABLE "portal_designs" ADD COLUMN IF NOT EXISTS "draft_version" integer DEFAULT 0 NOT NULL;
