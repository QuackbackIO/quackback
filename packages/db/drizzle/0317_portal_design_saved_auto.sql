-- @contract: safe-after 0.15.0 (the kind check is widened to also allow auto; portal_design_saved is new since 0.15.0, and every existing row and writer stays valid)
-- Automatic saves of the portal design draft, taken before anything replaces
-- it (a discard, a restore, a brand match, a copy from an old version, an
-- agent's patch) and every so often while someone edits. They sit beside the
-- named checkpoints and looks with a cap of their own, so they never push
-- out anything a person saved.
ALTER TABLE "portal_design_saved" DROP CONSTRAINT IF EXISTS "portal_design_saved_kind_check";
--> statement-breakpoint
ALTER TABLE "portal_design_saved" ADD CONSTRAINT "portal_design_saved_kind_check" CHECK ("kind" IN ('checkpoint', 'look', 'auto'));
