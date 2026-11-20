-- @contract: additive
-- The plan limits state: when this workspace was first seen over its plan's
-- limits, when its grace ends, the plan and features it had before, and the
-- admin's choices (the board that stays open, who keeps a seat, which status
-- components stay visible). Null means the workspace fits its plan. Read and
-- written only through the settings service.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "plan_limits_state" jsonb;
