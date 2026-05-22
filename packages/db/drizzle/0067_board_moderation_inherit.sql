-- Backfill: boards moderation.requireApproval -> 'inherit'.
-- Upgraded instances have boards with requireApproval='none' set before
-- Phase 1; this moves those to 'inherit' so they follow the workspace
-- default. Boards with any other explicit value are intentional overrides
-- and are left unchanged.
UPDATE "boards"
SET "moderation" = jsonb_set("moderation", '{requireApproval}', '"inherit"', true)
WHERE "moderation" IS NOT NULL
  AND "moderation" ->> 'requireApproval' = 'none';
