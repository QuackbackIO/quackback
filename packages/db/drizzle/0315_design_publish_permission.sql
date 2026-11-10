-- @contract: additive
-- Publishing the portal design gets its own permission, design.publish. Every
-- role that holds settings.branding today also gets it, so nobody gains or
-- loses access; a custom role can then keep one without the other.
-- Replay-safe: every insert skips what exists.
INSERT INTO "permissions" ("id", "key", "category", "description", "is_system", "created_at")
VALUES
  (gen_random_uuid(), 'design.publish', 'workspace', 'Publish the portal design, restore an earlier version, and switch the portal to or from it', true, now())
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), branding."role_id", publish."id"
FROM "role_permissions" branding
JOIN "permissions" branding_perm ON branding_perm."id" = branding."permission_id" AND branding_perm."key" = 'settings.branding'
JOIN "permissions" publish ON publish."key" = 'design.publish'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
