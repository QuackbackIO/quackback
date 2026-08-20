-- Every existing verified sending domain goes back to pending.
--
-- The verification these rows carry was made by a check that could not tell an
-- owner from anybody else. It looked for a TXT record CONTAINING a shared
-- provider's SPF include, plus a CNAME pointing at a constant target — two
-- values that are the same for every workspace we hand instructions to, and
-- neither of which requires control of the zone being claimed. On a fleet where
-- one provider account signs for every workspace, a row verified that way is a
-- claim nobody checked.
--
-- Until now that claim was cosmetic: a badge in the settings UI. The sending
-- identity guard promotes it into the sole authority for the From address on
-- outbound mail, so leaving these rows alone would not preserve their meaning,
-- it would grant them one they were never given. A workspace that "verified"
-- someone else's domain would begin sending signed as that domain the moment
-- the guard shipped.
--
-- So they are demoted rather than migrated. There is no way to recover the
-- missing evidence after the fact: the ownership token is minted per row and no
-- old row has one, so a row's owner is exactly as unknown now as it was then.
-- The cost is that a workspace with a genuinely owned domain publishes one more
-- TXT record and clicks Check; the cost of the alternative is unbounded.
--
-- `verified_at` is cleared with the status. It records the moment a domain
-- became trustworthy, and none of these rows has had such a moment. Leaving the
-- stamp would make the next verification look like it had already happened, and
-- the code stamps that column only on the pending-to-verified transition.
--
-- `last_checked_at` is left alone: it records when we last looked, which is
-- true and is not a grant.
--
-- Replay-safe: the predicate is the status being changed, so a second run
-- matches nothing. It is also correct on a database where the guard has already
-- shipped and rows have been verified through the new path — those rows carry
-- an ownership record, and the WHERE below skips them.
UPDATE "email_sending_domains"
SET "status" = 'pending',
    "verified_at" = NULL,
    "updated_at" = now()
WHERE "status" = 'verified'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements("dns_records") AS record
    WHERE record ->> 'purpose' = 'ownership'
  );
