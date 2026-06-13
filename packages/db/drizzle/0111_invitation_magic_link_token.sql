-- Tracks the verification-table identifier (the magic-link token) currently
-- minted for this invitation. Lets the cancel / re-send paths delete the
-- backing `verification` row so a cancelled or superseded invite link can no
-- longer mint a session -- without it, the emailed token stays live for its
-- full 30-day TTL regardless of the invite's status.
--
-- Additive + backfill-safe: existing pending invites get NULL (their tokens
-- self-expire at the row's expires_at and are simply not revocable). Deletes
-- by verification.identifier are served by the existing verification_identifier_idx.
ALTER TABLE "invitation" ADD COLUMN "magic_link_token" text;
