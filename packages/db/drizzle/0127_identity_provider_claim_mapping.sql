-- One sectioned claim-mapping column, absorbing attribute_mapping.
--
-- `attribute_mapping` held { claimPath, rules, syncOnEverySignIn } and mapped
-- a claim to a ROLE. Profile-field mapping and user-attribute mapping both
-- needed somewhere to live, so there is one `claim_mapping` with named
-- sections: `profile`, `role`, and `attributes`.
--
-- The role section is a verbatim move: same keys, same semantics.
-- Keep `attribute_mapping` this release so rolling pods still on the old
-- schema can select and write it. A later migration drops the column.
ALTER TABLE "identity_provider" ADD COLUMN IF NOT EXISTS "claim_mapping" jsonb;

UPDATE "identity_provider"
SET "claim_mapping" = jsonb_build_object('role', "attribute_mapping")
WHERE "attribute_mapping" IS NOT NULL
  AND "claim_mapping" IS NULL;
