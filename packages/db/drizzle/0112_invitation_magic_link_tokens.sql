-- Track the FULL set of magic-link tokens minted for an invitation, not just
-- the latest. send/resend/copy each append a token; cancel revokes them all.
-- This makes cancellation robust under concurrency and worker restarts: a
-- token minted during a resend's email-send window is recorded immediately, so
-- it can never end up live-but-untracked (and thus survive a later cancel) the
-- way a single rotating pointer could.
--
-- Replaces the single magic_link_token column added in 0111. Backfill-safe:
-- existing pending invites carry their one tracked token into the array.
ALTER TABLE "invitation" ADD COLUMN "magic_link_tokens" text[] NOT NULL DEFAULT '{}';

UPDATE "invitation"
  SET "magic_link_tokens" = ARRAY["magic_link_token"]
  WHERE "magic_link_token" IS NOT NULL;

ALTER TABLE "invitation" DROP COLUMN "magic_link_token";
