-- External-surface coverage: new RBAC permissions for resources newly exposed
-- via the REST API / MCP server (teams, segments, user attributes, portal &
-- widget config, conversations, moderation).
--
-- Mirrors the role grants in
-- apps/web/src/lib/server/domains/authz/authz.permissions.ts. Re-runnable:
-- every INSERT uses ON CONFLICT DO NOTHING so partial-state deploys recover.

-- ---------------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------------
INSERT INTO "permissions" ("id", "key", "category", "description", "is_system") VALUES
  (gen_random_uuid(), 'team.view',             'team',       'View teams and their membership.', true),
  (gen_random_uuid(), 'team.manage',           'team',       'Create, update, and archive teams and manage team membership.', true),
  (gen_random_uuid(), 'segment.view',          'audience',   'View audience segments and their membership.', true),
  (gen_random_uuid(), 'segment.manage',        'audience',   'Create, update, and delete segments and manage segment membership.', true),
  (gen_random_uuid(), 'user_attribute.view',   'audience',   'View custom user attribute definitions.', true),
  (gen_random_uuid(), 'user_attribute.manage', 'audience',   'Create, update, and delete custom user attribute definitions.', true),
  (gen_random_uuid(), 'portal.manage',         'portal',     'Configure portal tabs and visibility (org-wide and per-segment).', true),
  (gen_random_uuid(), 'widget.view',           'portal',     'View widget applications and environment profiles.', true),
  (gen_random_uuid(), 'widget.manage',         'portal',     'Create and update widget applications and environment profiles.', true),
  (gen_random_uuid(), 'chat.view',             'chat',       'View support conversations and messages.', true),
  (gen_random_uuid(), 'chat.manage',           'chat',       'Reply, assign, prioritise, note, tag, and resolve conversations.', true),
  (gen_random_uuid(), 'moderation.view',       'moderation', 'View posts and comments pending moderation.', true),
  (gen_random_uuid(), 'moderation.manage',     'moderation', 'Approve or reject posts and comments.', true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grant role_permissions
-- ---------------------------------------------------------------------------
-- Owner: re-grant every permission (covers the new keys).
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'owner'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint

-- Supervisor: all new operational + structural config (admin.* stays owner-only).
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.key IN (
  'team.view', 'team.manage',
  'segment.view', 'segment.manage',
  'user_attribute.view', 'user_attribute.manage',
  'portal.manage', 'widget.view', 'widget.manage',
  'chat.view', 'chat.manage',
  'moderation.view', 'moderation.manage'
)
WHERE r.key = 'supervisor'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint

-- Agent: front-line conversation handling + read context.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.key IN (
  'chat.view', 'chat.manage', 'team.view', 'segment.view'
)
WHERE r.key = 'agent'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
