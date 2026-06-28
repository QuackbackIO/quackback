-- Consolidate the two SSO "default role" controls into one (auto_provision_role).
-- When attribute mapping was enabled, the live default was attribute_mapping.defaultRole
-- (auto_provision_role was unreachable). Promote it to the single source of truth
-- before the code stops reading the nested field, then drop the redundant key.
-- Idempotent: re-running is a no-op once defaultRole is gone.
UPDATE "identity_provider"
SET "auto_provision_role" = "attribute_mapping"->>'defaultRole'
WHERE "attribute_mapping" IS NOT NULL
  AND "attribute_mapping" ? 'defaultRole'
  AND "auto_provision_role" IS DISTINCT FROM ("attribute_mapping"->>'defaultRole');
--> statement-breakpoint
UPDATE "identity_provider"
SET "attribute_mapping" = "attribute_mapping" - 'defaultRole'
WHERE "attribute_mapping" IS NOT NULL
  AND "attribute_mapping" ? 'defaultRole';
