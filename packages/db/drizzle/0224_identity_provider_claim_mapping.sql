-- One sectioned claim-mapping column, absorbing attribute_mapping.
--
-- `attribute_mapping` never mapped attributes. It held { claimPath, rules,
-- syncOnEverySignIn } and mapped a claim to a ROLE. Profile-field mapping and
-- user-attribute mapping both needed somewhere to live, and adding a column
-- each would have left three overlapping mapping concepts on this table, two of
-- them misleadingly named. So there is one `claim_mapping` with named sections:
-- `profile`, `role`, and `attributes`.
--
-- The role section is a verbatim move: same keys, same semantics, so any row
-- that had a working role mapping keeps behaving identically. Rows with no
-- attribute_mapping get NULL, which reads as "not configured" and leaves the
-- standard OIDC claims in charge.
ALTER TABLE "identity_provider" ADD COLUMN IF NOT EXISTS "claim_mapping" jsonb;

UPDATE "identity_provider"
SET "claim_mapping" = jsonb_build_object('role', "attribute_mapping")
WHERE "attribute_mapping" IS NOT NULL
  AND "claim_mapping" IS NULL;

ALTER TABLE "identity_provider" DROP COLUMN IF EXISTS "attribute_mapping";
