-- Ticketing — Phase 1: RBAC + teams + audit foundation.
--
-- Adds three new domains alongside the existing schema:
--   1. teams + team_memberships (first-class grouping for principals)
--   2. roles + permissions + role_permissions + principal_role_assignments
--      (generic RBAC engine; the legacy principal.role column is kept as a
--      denormalised cache)
--   3. audit_events (append-only workspace-wide admin/security log)
--
-- The migration also seeds the five system roles described in
-- apps/web/src/lib/server/domains/authz/authz.permissions.ts and backfills
-- existing principals into the role-assignment table so requireAuth() and
-- requirePermission() agree on day one.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "teams" (
  "id" uuid PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "short_label" text,
  "color" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_idx" ON "teams" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "teams_archived_at_idx" ON "teams" USING btree ("archived_at");
--> statement-breakpoint

CREATE TABLE "team_memberships" (
  "id" uuid PRIMARY KEY NOT NULL,
  "team_id" uuid NOT NULL,
  "principal_id" uuid NOT NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_memberships"
  ADD CONSTRAINT "team_memberships_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_memberships"
  ADD CONSTRAINT "team_memberships_principal_id_principal_id_fk"
  FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_team_principal_idx"
  ON "team_memberships" USING btree ("team_id", "principal_id");
--> statement-breakpoint
CREATE INDEX "team_memberships_principal_idx"
  ON "team_memberships" USING btree ("principal_id");
--> statement-breakpoint

CREATE TABLE "roles" (
  "id" uuid PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_idx" ON "roles" USING btree ("key");
--> statement-breakpoint

CREATE TABLE "permissions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "category" text NOT NULL,
  "description" text,
  "is_system" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_idx" ON "permissions" USING btree ("key");
--> statement-breakpoint
CREATE INDEX "permissions_category_idx" ON "permissions" USING btree ("category");
--> statement-breakpoint

CREATE TABLE "role_permissions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "role_id" uuid NOT NULL,
  "permission_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_id_roles_id_fk"
  FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk"
  FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_permission_idx"
  ON "role_permissions" USING btree ("role_id", "permission_id");
--> statement-breakpoint
CREATE INDEX "role_permissions_permission_idx"
  ON "role_permissions" USING btree ("permission_id");
--> statement-breakpoint

CREATE TABLE "principal_role_assignments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "principal_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "team_id" uuid,
  "granted_by_principal_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "principal_role_assignments"
  ADD CONSTRAINT "principal_role_assignments_principal_id_principal_id_fk"
  FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "principal_role_assignments"
  ADD CONSTRAINT "principal_role_assignments_role_id_roles_id_fk"
  FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "principal_role_assignments"
  ADD CONSTRAINT "principal_role_assignments_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "principal_role_assignments"
  ADD CONSTRAINT "principal_role_assignments_granted_by_principal_id_principal_id_fk"
  FOREIGN KEY ("granted_by_principal_id") REFERENCES "public"."principal"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "principal_role_assignments_principal_role_team_idx"
  ON "principal_role_assignments" USING btree ("principal_id", "role_id", "team_id")
  WHERE team_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "principal_role_assignments_principal_role_workspace_idx"
  ON "principal_role_assignments" USING btree ("principal_id", "role_id")
  WHERE team_id IS NULL;
--> statement-breakpoint
CREATE INDEX "principal_role_assignments_principal_idx"
  ON "principal_role_assignments" USING btree ("principal_id");
--> statement-breakpoint
CREATE INDEX "principal_role_assignments_team_idx"
  ON "principal_role_assignments" USING btree ("team_id");
--> statement-breakpoint

CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "principal_id" uuid,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text,
  "diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source" text DEFAULT 'web' NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_principal_id_principal_id_fk"
  FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx"
  ON "audit_events" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "audit_events_principal_idx"
  ON "audit_events" USING btree ("principal_id", "created_at");
--> statement-breakpoint
CREATE INDEX "audit_events_action_idx"
  ON "audit_events" USING btree ("action", "created_at");
--> statement-breakpoint
CREATE INDEX "audit_events_target_idx"
  ON "audit_events" USING btree ("target_type", "target_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seed system permissions
-- ---------------------------------------------------------------------------
-- Inserts every permission listed in authz.permissions.ts. Re-runnable: ON
-- CONFLICT (key) DO NOTHING so deploys with partial state recover cleanly.

INSERT INTO "permissions" ("id", "key", "category", "description", "is_system") VALUES
  (gen_random_uuid(), 'ticket.view_all',            'ticket', 'View every ticket in the workspace.', true),
  (gen_random_uuid(), 'ticket.view_team',           'ticket', 'View tickets owned by, assigned to, or shared with one of the actor''s teams.', true),
  (gen_random_uuid(), 'ticket.view_assigned',       'ticket', 'View tickets assigned to the actor.', true),
  (gen_random_uuid(), 'ticket.view_shared',         'ticket', 'View tickets shared with one of the actor''s teams.', true),
  (gen_random_uuid(), 'ticket.reply_public',        'ticket', 'Post a customer-visible reply.', true),
  (gen_random_uuid(), 'ticket.comment_internal',    'ticket', 'Post an internal note.', true),
  (gen_random_uuid(), 'ticket.edit_fields',         'ticket', 'Edit ticket fields (status, priority, assignee, etc.).', true),
  (gen_random_uuid(), 'ticket.assign_self',         'ticket', 'Assign tickets to oneself.', true),
  (gen_random_uuid(), 'ticket.assign_any',          'ticket', 'Assign tickets to any principal.', true),
  (gen_random_uuid(), 'ticket.share_cross_team',    'ticket', 'Share a ticket with another team.', true),
  (gen_random_uuid(), 'ticket.manage_participants', 'ticket', 'Add or remove ticket participants.', true),
  (gen_random_uuid(), 'org.view',                   'org',    'View organizations and contacts.', true),
  (gen_random_uuid(), 'org.manage',                 'org',    'Create and edit organizations and contacts.', true),
  (gen_random_uuid(), 'sla.view',                   'sla',    'View SLA policies and clocks.', true),
  (gen_random_uuid(), 'sla.manage',                 'sla',    'Create and edit SLA policies.', true),
  (gen_random_uuid(), 'audit.view',                 'audit',  'Read the workspace audit log.', true),
  (gen_random_uuid(), 'admin.manage_users',         'admin',  'Invite, remove, and update team members and teams.', true),
  (gen_random_uuid(), 'admin.manage_roles',         'admin',  'Edit role bundles and grant/revoke roles.', true),
  (gen_random_uuid(), 'admin.manage_api_keys',      'admin',  'Create, rotate, and revoke API keys.', true),
  (gen_random_uuid(), 'admin.manage_settings',      'admin',  'Edit workspace-wide settings.', true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seed system roles
-- ---------------------------------------------------------------------------

INSERT INTO "roles" ("id", "key", "name", "description", "is_system") VALUES
  (gen_random_uuid(), 'owner',        'Owner',        'Full administrative access.', true),
  (gen_random_uuid(), 'supervisor',   'Supervisor',   'Team operations: assignment, sharing, audit visibility.', true),
  (gen_random_uuid(), 'agent',        'Agent',        'Default support agent: handles tickets within allowed scopes.', true),
  (gen_random_uuid(), 'collaborator', 'Collaborator', 'Internal collaborator: notes and read access on shared tickets.', true),
  (gen_random_uuid(), 'customer',     'Customer',     'Portal user role; no internal-side permissions.', true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seed role_permissions
-- ---------------------------------------------------------------------------
-- Owner: every permission.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'owner'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint

-- Supervisor.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.key IN (
  'ticket.view_all', 'ticket.view_team', 'ticket.view_assigned', 'ticket.view_shared',
  'ticket.reply_public', 'ticket.comment_internal', 'ticket.edit_fields',
  'ticket.assign_self', 'ticket.assign_any', 'ticket.share_cross_team',
  'ticket.manage_participants',
  'org.view', 'org.manage',
  'sla.view',
  'audit.view'
)
WHERE r.key = 'supervisor'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint

-- Agent.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.key IN (
  'ticket.view_team', 'ticket.view_assigned', 'ticket.view_shared',
  'ticket.reply_public', 'ticket.comment_internal', 'ticket.edit_fields',
  'ticket.assign_self',
  'org.view',
  'sla.view'
)
WHERE r.key = 'agent'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint

-- Collaborator.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.key IN (
  'ticket.view_shared', 'ticket.view_assigned', 'ticket.comment_internal',
  'org.view'
)
WHERE r.key = 'collaborator'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint

-- Customer: no internal-side permissions on purpose.

-- ---------------------------------------------------------------------------
-- Backfill existing principals → role assignments
-- ---------------------------------------------------------------------------
-- principal.role 'admin'  → owner
-- principal.role 'member' → agent (admins can promote to supervisor afterwards)
-- principal.role 'user'   → customer
--
-- Workspace-wide grants only (team_id IS NULL).

INSERT INTO "principal_role_assignments" ("id", "principal_id", "role_id", "team_id")
SELECT gen_random_uuid(), pr.id, r.id, NULL
FROM "principal" pr
JOIN "roles" r ON r.key = CASE pr.role
  WHEN 'admin'  THEN 'owner'
  WHEN 'member' THEN 'agent'
  WHEN 'user'   THEN 'customer'
  ELSE 'agent'
END
ON CONFLICT DO NOTHING;
-- Ticketing — Phase 2: organizations & contacts.
--
-- Adds three tables consumed by Phase 3 ticket intake (`findOrCreateByDomain`,
-- `findOrCreateByEmail`) and the upcoming admin CRM views.
--
-- No data is seeded; tables are populated through the new REST API and the
-- Phase 3 ticket pipeline.

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

CREATE TABLE "organizations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "domain" text,
  "external_id" text,
  "website" text,
  "notes" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_domain_idx"
  ON "organizations" USING btree ("domain")
  WHERE domain IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_external_id_idx"
  ON "organizations" USING btree ("external_id")
  WHERE external_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "organizations_name_idx" ON "organizations" USING btree ("name");
--> statement-breakpoint
CREATE INDEX "organizations_archived_at_idx" ON "organizations" USING btree ("archived_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------

CREATE TABLE "contacts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text,
  "email" text,
  "phone" text,
  "title" text,
  "external_id" text,
  "organization_id" uuid,
  "avatar_url" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_idx"
  ON "contacts" USING btree ("email")
  WHERE email IS NOT NULL AND archived_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_external_id_idx"
  ON "contacts" USING btree ("external_id")
  WHERE external_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "contacts_organization_idx" ON "contacts" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "contacts_archived_at_idx" ON "contacts" USING btree ("archived_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- contact_user_links (N:M between contacts and portal users)
-- ---------------------------------------------------------------------------

CREATE TABLE "contact_user_links" (
  "id" uuid PRIMARY KEY NOT NULL,
  "contact_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "linked_by_principal_id" uuid,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_user_links"
  ADD CONSTRAINT "contact_user_links_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_user_links"
  ADD CONSTRAINT "contact_user_links_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_user_links"
  ADD CONSTRAINT "contact_user_links_linked_by_principal_id_principal_id_fk"
  FOREIGN KEY ("linked_by_principal_id") REFERENCES "public"."principal"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_user_links_contact_user_idx"
  ON "contact_user_links" USING btree ("contact_id", "user_id");
--> statement-breakpoint
CREATE INDEX "contact_user_links_user_idx" ON "contact_user_links" USING btree ("user_id");
-- Ticketing — Phase 3: ticket core.
--
-- Seven new tables forming the heart of the ticketing module:
--   * ticket_statuses        configurable workflow states (5 seeded)
--   * tickets                header / state / assignment / visibility
--   * ticket_threads         messages (public / internal / shared_team)
--   * ticket_attachments     metadata for files attached to a thread
--   * ticket_participants    watchers / collaborators / cc'd contacts
--   * ticket_shares          cross-team grants
--   * ticket_activity        per-ticket timeline mirror
--
-- `tickets.inbox_id` and `tickets.sla_policy_id` are intentionally plain TEXT
-- (no FKs) — Phases 4 and 5 will add the foreign keys without rewriting rows.

-- ---------------------------------------------------------------------------
-- ticket_statuses
-- ---------------------------------------------------------------------------

CREATE TABLE "ticket_statuses" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "color" text DEFAULT '#6b7280' NOT NULL,
  "category" text DEFAULT 'open' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "ticket_statuses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "ticket_statuses_position_idx" ON "ticket_statuses" USING btree ("category", "position");
--> statement-breakpoint
CREATE INDEX "ticket_statuses_deleted_at_idx" ON "ticket_statuses" USING btree ("deleted_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- tickets
-- ---------------------------------------------------------------------------

CREATE TABLE "tickets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "subject" text NOT NULL,
  "description_json" jsonb,
  "description_text" text,
  "priority" text DEFAULT 'normal' NOT NULL,
  "channel" text DEFAULT 'api' NOT NULL,
  "visibility_scope" text DEFAULT 'team' NOT NULL,
  "status_id" uuid,
  "requester_principal_id" uuid,
  "requester_contact_id" uuid,
  "organization_id" uuid,
  "assignee_principal_id" uuid,
  "assignee_team_id" uuid,
  "primary_team_id" uuid,
  "inbox_id" text,
  "sla_policy_id" text,
  "first_response_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "reopened_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "created_by_principal_id" uuid,
  "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "deleted_by_principal_id" uuid
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_id_ticket_statuses_id_fk"
  FOREIGN KEY ("status_id") REFERENCES "public"."ticket_statuses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_principal_id_principal_id_fk"
  FOREIGN KEY ("requester_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_contact_id_contacts_id_fk"
  FOREIGN KEY ("requester_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_principal_id_principal_id_fk"
  FOREIGN KEY ("assignee_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_team_id_teams_id_fk"
  FOREIGN KEY ("assignee_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_primary_team_id_teams_id_fk"
  FOREIGN KEY ("primary_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_principal_id_principal_id_fk"
  FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_deleted_by_principal_id_principal_id_fk"
  FOREIGN KEY ("deleted_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tickets_status_id_idx" ON "tickets" USING btree ("status_id");
--> statement-breakpoint
CREATE INDEX "tickets_assignee_principal_idx" ON "tickets" USING btree ("assignee_principal_id");
--> statement-breakpoint
CREATE INDEX "tickets_primary_team_idx" ON "tickets" USING btree ("primary_team_id");
--> statement-breakpoint
CREATE INDEX "tickets_organization_idx" ON "tickets" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "tickets_requester_contact_idx" ON "tickets" USING btree ("requester_contact_id");
--> statement-breakpoint
CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "tickets_last_activity_at_idx" ON "tickets" USING btree ("last_activity_at");
--> statement-breakpoint
CREATE INDEX "tickets_deleted_at_idx" ON "tickets" USING btree ("deleted_at");
--> statement-breakpoint
CREATE INDEX "tickets_team_status_idx" ON "tickets" USING btree ("primary_team_id", "status_id");
--> statement-breakpoint
CREATE INDEX "tickets_active_last_activity_idx"
  ON "tickets" USING btree ("last_activity_at")
  WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ticket_threads
-- ---------------------------------------------------------------------------

CREATE TABLE "ticket_threads" (
  "id" uuid PRIMARY KEY NOT NULL,
  "ticket_id" uuid NOT NULL,
  "principal_id" uuid,
  "audience" text NOT NULL,
  "body_json" jsonb,
  "body_text" text NOT NULL,
  "shared_with_team_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "edited_at" timestamp with time zone,
  "edited_by_principal_id" uuid,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "ticket_threads_shared_team_required"
    CHECK ((audience <> 'shared_team') OR (shared_with_team_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "ticket_threads" ADD CONSTRAINT "ticket_threads_ticket_id_tickets_id_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_threads" ADD CONSTRAINT "ticket_threads_principal_id_principal_id_fk"
  FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_threads" ADD CONSTRAINT "ticket_threads_shared_with_team_id_teams_id_fk"
  FOREIGN KEY ("shared_with_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_threads" ADD CONSTRAINT "ticket_threads_edited_by_principal_id_principal_id_fk"
  FOREIGN KEY ("edited_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ticket_threads_ticket_id_created_at_idx"
  ON "ticket_threads" USING btree ("ticket_id", "created_at");
--> statement-breakpoint
CREATE INDEX "ticket_threads_audience_idx" ON "ticket_threads" USING btree ("audience");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ticket_attachments
-- ---------------------------------------------------------------------------

CREATE TABLE "ticket_attachments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "thread_id" uuid NOT NULL,
  "uploaded_by_principal_id" uuid,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_key" text NOT NULL,
  "public_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_thread_id_ticket_threads_id_fk"
  FOREIGN KEY ("thread_id") REFERENCES "public"."ticket_threads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_uploaded_by_principal_id_principal_id_fk"
  FOREIGN KEY ("uploaded_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ticket_attachments_thread_idx" ON "ticket_attachments" USING btree ("thread_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ticket_participants
-- ---------------------------------------------------------------------------

CREATE TABLE "ticket_participants" (
  "id" uuid PRIMARY KEY NOT NULL,
  "ticket_id" uuid NOT NULL,
  "principal_id" uuid,
  "contact_id" uuid,
  "role" text NOT NULL,
  "added_by_principal_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ticket_participants_one_subject"
    CHECK ((principal_id IS NOT NULL)::int + (contact_id IS NOT NULL)::int = 1)
);
--> statement-breakpoint
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_ticket_id_tickets_id_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_principal_id_principal_id_fk"
  FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_added_by_principal_id_principal_id_fk"
  FOREIGN KEY ("added_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_participants_ticket_principal_idx"
  ON "ticket_participants" USING btree ("ticket_id", "principal_id")
  WHERE principal_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_participants_ticket_contact_idx"
  ON "ticket_participants" USING btree ("ticket_id", "contact_id")
  WHERE contact_id IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ticket_shares
-- ---------------------------------------------------------------------------

CREATE TABLE "ticket_shares" (
  "id" uuid PRIMARY KEY NOT NULL,
  "ticket_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "access_level" text DEFAULT 'read' NOT NULL,
  "granted_by_principal_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by_principal_id" uuid
);
--> statement-breakpoint
ALTER TABLE "ticket_shares" ADD CONSTRAINT "ticket_shares_ticket_id_tickets_id_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_shares" ADD CONSTRAINT "ticket_shares_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_shares" ADD CONSTRAINT "ticket_shares_granted_by_principal_id_principal_id_fk"
  FOREIGN KEY ("granted_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_shares" ADD CONSTRAINT "ticket_shares_revoked_by_principal_id_principal_id_fk"
  FOREIGN KEY ("revoked_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_shares_ticket_team_active_idx"
  ON "ticket_shares" USING btree ("ticket_id", "team_id")
  WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX "ticket_shares_team_idx" ON "ticket_shares" USING btree ("team_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ticket_activity
-- ---------------------------------------------------------------------------

CREATE TABLE "ticket_activity" (
  "id" uuid PRIMARY KEY NOT NULL,
  "ticket_id" uuid NOT NULL,
  "principal_id" uuid,
  "type" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_ticket_id_tickets_id_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_principal_id_principal_id_fk"
  FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ticket_activity_ticket_id_created_idx"
  ON "ticket_activity" USING btree ("ticket_id", "created_at");
--> statement-breakpoint
CREATE INDEX "ticket_activity_type_idx" ON "ticket_activity" USING btree ("type");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seed default ticket statuses (idempotent — safe on re-run)
-- ---------------------------------------------------------------------------

INSERT INTO "ticket_statuses" ("id", "name", "slug", "color", "category", "position", "is_default", "is_system")
VALUES
  (gen_random_uuid(), 'Open',    'open',    '#3b82f6', 'open',    0, true,  true),
  (gen_random_uuid(), 'Pending', 'pending', '#eab308', 'pending', 1, false, true),
  (gen_random_uuid(), 'On hold', 'on_hold', '#a855f7', 'on_hold', 2, false, true),
  (gen_random_uuid(), 'Solved',  'solved',  '#22c55e', 'solved',  3, false, true),
  (gen_random_uuid(), 'Closed',  'closed',  '#6b7280', 'closed',  4, false, true)
ON CONFLICT ("slug") DO NOTHING;
-- Phase 4: inboxes, channels, memberships, routing rules.
-- Adds tables: inboxes, inbox_channels, inbox_memberships, routing_rules.
-- Backfills FK from existing tickets.inbox_id (was text → now uuid) → inboxes(id).
-- Seeds 5 new permissions and grants them into the existing system roles.

-- ---------------------------------------------------------------------------
-- inboxes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "inboxes" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "primary_team_id" uuid,
  "default_visibility_scope" text DEFAULT 'team' NOT NULL,
  "default_priority" text DEFAULT 'normal' NOT NULL,
  "default_status_id" uuid,
  "color" text,
  "icon" text,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_primary_team_id_teams_id_fk"
  FOREIGN KEY ("primary_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_default_status_id_ticket_statuses_id_fk"
  FOREIGN KEY ("default_status_id") REFERENCES "public"."ticket_statuses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inboxes_slug_idx" ON "inboxes" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inboxes_primary_team_idx" ON "inboxes" USING btree ("primary_team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inboxes_archived_at_idx" ON "inboxes" USING btree ("archived_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inboxes_active_name_idx"
  ON "inboxes" USING btree (lower("name"))
  WHERE archived_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- inbox_channels
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "inbox_channels" (
  "id" uuid PRIMARY KEY NOT NULL,
  "inbox_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "external_id" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inbox_channels_kind_check"
    CHECK ("kind" IN ('portal', 'email', 'api', 'widget', 'webhook'))
);
--> statement-breakpoint
ALTER TABLE "inbox_channels" ADD CONSTRAINT "inbox_channels_inbox_id_inboxes_id_fk"
  FOREIGN KEY ("inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_channels_inbox_idx" ON "inbox_channels" USING btree ("inbox_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_channels_kind_external_id_idx"
  ON "inbox_channels" USING btree ("kind", "external_id")
  WHERE external_id IS NOT NULL AND archived_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- inbox_memberships
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "inbox_memberships" (
  "id" uuid PRIMARY KEY NOT NULL,
  "inbox_id" uuid NOT NULL,
  "principal_id" uuid NOT NULL,
  "role" text DEFAULT 'agent' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inbox_memberships_role_check"
    CHECK ("role" IN ('owner', 'agent', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "inbox_memberships" ADD CONSTRAINT "inbox_memberships_inbox_id_inboxes_id_fk"
  FOREIGN KEY ("inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_memberships" ADD CONSTRAINT "inbox_memberships_principal_id_principal_id_fk"
  FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_memberships_inbox_principal_idx"
  ON "inbox_memberships" USING btree ("inbox_id", "principal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_memberships_principal_idx"
  ON "inbox_memberships" USING btree ("principal_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- routing_rules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "routing_rules" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "priority" integer DEFAULT 100 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "conditions" jsonb NOT NULL,
  "actions" jsonb NOT NULL,
  "inbox_id_scope" uuid,
  "last_matched_at" timestamp with time zone,
  "match_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_inbox_id_scope_inboxes_id_fk"
  FOREIGN KEY ("inbox_id_scope") REFERENCES "public"."inboxes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_rules_priority_idx" ON "routing_rules" USING btree ("priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_rules_inbox_scope_idx" ON "routing_rules" USING btree ("inbox_id_scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_rules_enabled_idx" ON "routing_rules" USING btree ("enabled");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill tickets.inbox_id: was text (Phase 3 reservation); now uuid + FK.
-- Safe: column has no real values yet (Phase 3 stored nothing here).
-- ---------------------------------------------------------------------------

ALTER TABLE "tickets" ALTER COLUMN "inbox_id" TYPE uuid USING (NULLIF("inbox_id", '')::uuid);
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_inbox_id_inboxes_id_fk"
  FOREIGN KEY ("inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_inbox_idx" ON "tickets" USING btree ("inbox_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seed Phase 4 permissions
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("id", "key", "category", "description", "is_system") VALUES
  (gen_random_uuid(), 'inbox.view',           'inbox', 'View inboxes and their queues.', true),
  (gen_random_uuid(), 'inbox.manage',         'inbox', 'Create, update, and archive inboxes and memberships.', true),
  (gen_random_uuid(), 'inbox.channel_manage', 'inbox', 'Configure inbox channels (portal/email/api/widget/webhook).', true),
  (gen_random_uuid(), 'routing.rule_manage',  'inbox', 'Create and edit routing rules.', true),
  (gen_random_uuid(), 'ticket.bulk_operate',  'ticket', 'Perform bulk ticket operations (assign / transition / change inbox).', true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Re-grant owner = all permissions (covers the new keys).
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'owner'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint

-- Supervisor gains all Phase 4 perms.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.key IN (
  'inbox.view', 'inbox.manage', 'inbox.channel_manage',
  'routing.rule_manage', 'ticket.bulk_operate'
)
WHERE r.key = 'supervisor'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint

-- Agent gains inbox.view + ticket.bulk_operate.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.key IN ('inbox.view', 'ticket.bulk_operate')
WHERE r.key = 'agent'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
-- Phase 5: SLA + escalations.
-- Adds tables: business_hours, sla_policies, sla_targets, ticket_sla_clocks,
-- escalation_rules, sla_escalation_log.
-- Converts tickets.sla_policy_id from text to uuid + FK -> sla_policies(id).
-- Seeds 2 new permissions; SLA_VIEW/SLA_MANAGE were seeded in Phase 1 already
-- but we re-grant them here to be safe.

-- ---------------------------------------------------------------------------
-- business_hours
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "business_hours" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "schedule" jsonb NOT NULL,
  "holidays" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_hours_archived_at_idx"
  ON "business_hours" USING btree ("archived_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_hours_active_name_idx"
  ON "business_hours" USING btree (lower("name"))
  WHERE archived_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sla_policies
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "sla_policies" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "priority" integer DEFAULT 100 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "scope" text NOT NULL,
  "scope_team_id" uuid,
  "scope_inbox_id" uuid,
  "applies_to_priorities" text[] DEFAULT '{}'::text[] NOT NULL,
  "business_hours_id" uuid,
  "pause_on_pending" boolean DEFAULT true NOT NULL,
  "pause_on_on_hold" boolean DEFAULT true NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sla_policies_scope_check"
    CHECK ("scope" IN ('workspace', 'team', 'inbox')),
  CONSTRAINT "sla_policies_scope_team_required"
    CHECK ((scope <> 'team') OR (scope_team_id IS NOT NULL)),
  CONSTRAINT "sla_policies_scope_inbox_required"
    CHECK ((scope <> 'inbox') OR (scope_inbox_id IS NOT NULL)),
  CONSTRAINT "sla_policies_workspace_no_scope"
    CHECK ((scope <> 'workspace') OR (scope_team_id IS NULL AND scope_inbox_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_scope_team_id_teams_id_fk"
  FOREIGN KEY ("scope_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_scope_inbox_id_inboxes_id_fk"
  FOREIGN KEY ("scope_inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_business_hours_id_business_hours_id_fk"
  FOREIGN KEY ("business_hours_id") REFERENCES "public"."business_hours"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sla_policies_enabled_priority_idx"
  ON "sla_policies" USING btree ("enabled", "priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sla_policies_scope_team_idx"
  ON "sla_policies" USING btree ("scope_team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sla_policies_scope_inbox_idx"
  ON "sla_policies" USING btree ("scope_inbox_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sla_policies_archived_at_idx"
  ON "sla_policies" USING btree ("archived_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sla_targets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "sla_targets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "policy_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "minutes" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sla_targets_kind_check"
    CHECK ("kind" IN ('first_response', 'next_response', 'resolution')),
  CONSTRAINT "sla_targets_minutes_positive" CHECK (minutes > 0)
);
--> statement-breakpoint
ALTER TABLE "sla_targets" ADD CONSTRAINT "sla_targets_policy_id_sla_policies_id_fk"
  FOREIGN KEY ("policy_id") REFERENCES "public"."sla_policies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sla_targets_policy_kind_idx"
  ON "sla_targets" USING btree ("policy_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sla_targets_policy_idx"
  ON "sla_targets" USING btree ("policy_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ticket_sla_clocks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ticket_sla_clocks" (
  "id" uuid PRIMARY KEY NOT NULL,
  "ticket_id" uuid NOT NULL,
  "policy_id" uuid,
  "target_id" uuid,
  "kind" text NOT NULL,
  "state" text DEFAULT 'running' NOT NULL,
  "target_minutes" integer NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "paused_at" timestamp with time zone,
  "accumulated_paused_ms" bigint DEFAULT 0 NOT NULL,
  "breached_at" timestamp with time zone,
  "met_at" timestamp with time zone,
  "last_escalated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ticket_sla_clocks_kind_check"
    CHECK ("kind" IN ('first_response', 'next_response', 'resolution')),
  CONSTRAINT "ticket_sla_clocks_state_check"
    CHECK ("state" IN ('running', 'paused', 'met', 'breached', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "ticket_sla_clocks" ADD CONSTRAINT "ticket_sla_clocks_ticket_id_tickets_id_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_sla_clocks" ADD CONSTRAINT "ticket_sla_clocks_policy_id_sla_policies_id_fk"
  FOREIGN KEY ("policy_id") REFERENCES "public"."sla_policies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_sla_clocks" ADD CONSTRAINT "ticket_sla_clocks_target_id_sla_targets_id_fk"
  FOREIGN KEY ("target_id") REFERENCES "public"."sla_targets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_sla_clocks_ticket_idx"
  ON "ticket_sla_clocks" USING btree ("ticket_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_sla_clocks_policy_idx"
  ON "ticket_sla_clocks" USING btree ("policy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_sla_clocks_state_due_idx"
  ON "ticket_sla_clocks" USING btree ("state", "due_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_sla_clocks_active_kind_idx"
  ON "ticket_sla_clocks" USING btree ("ticket_id", "kind")
  WHERE state IN ('running', 'paused');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- escalation_rules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "escalation_rules" (
  "id" uuid PRIMARY KEY NOT NULL,
  "policy_id" uuid NOT NULL,
  "name" text NOT NULL,
  "lead_minutes" integer NOT NULL,
  "target_kind" text NOT NULL,
  "recipient_type" text NOT NULL,
  "recipient_team_id" uuid,
  "recipient_principal_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "channels" text[] DEFAULT '{in_app}'::text[] NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "escalation_rules_target_kind_check"
    CHECK ("target_kind" IN ('first_response', 'next_response', 'resolution')),
  CONSTRAINT "escalation_rules_recipient_type_check"
    CHECK ("recipient_type" IN ('assignee', 'team', 'principals', 'inbox_members')),
  CONSTRAINT "escalation_rules_team_required"
    CHECK ((recipient_type <> 'team') OR (recipient_team_id IS NOT NULL)),
  CONSTRAINT "escalation_rules_principals_required"
    CHECK ((recipient_type <> 'principals') OR (array_length(recipient_principal_ids, 1) >= 1))
);
--> statement-breakpoint
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_policy_id_sla_policies_id_fk"
  FOREIGN KEY ("policy_id") REFERENCES "public"."sla_policies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_recipient_team_id_teams_id_fk"
  FOREIGN KEY ("recipient_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "escalation_rules_policy_lead_idx"
  ON "escalation_rules" USING btree ("policy_id", "lead_minutes");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "escalation_rules_enabled_kind_idx"
  ON "escalation_rules" USING btree ("enabled", "target_kind");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sla_escalation_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "sla_escalation_log" (
  "id" uuid PRIMARY KEY NOT NULL,
  "clock_id" uuid NOT NULL,
  "rule_id" uuid,
  "fired_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recipient_principal_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "channels" text[] DEFAULT '{}'::text[] NOT NULL,
  "context" jsonb
);
--> statement-breakpoint
ALTER TABLE "sla_escalation_log" ADD CONSTRAINT "sla_escalation_log_clock_id_ticket_sla_clocks_id_fk"
  FOREIGN KEY ("clock_id") REFERENCES "public"."ticket_sla_clocks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sla_escalation_log" ADD CONSTRAINT "sla_escalation_log_rule_id_escalation_rules_id_fk"
  FOREIGN KEY ("rule_id") REFERENCES "public"."escalation_rules"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sla_escalation_log_clock_fired_idx"
  ON "sla_escalation_log" USING btree ("clock_id", "fired_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sla_escalation_log_rule_idx"
  ON "sla_escalation_log" USING btree ("rule_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill tickets.sla_policy_id: was text (Phase 3 reservation); now uuid + FK.
-- Safe: column has no real values yet.
-- ---------------------------------------------------------------------------

ALTER TABLE "tickets" ALTER COLUMN "sla_policy_id" TYPE uuid
  USING (NULLIF("sla_policy_id"::text, '')::uuid);
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_sla_policy_id_sla_policies_id_fk"
  FOREIGN KEY ("sla_policy_id") REFERENCES "public"."sla_policies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_sla_policy_idx" ON "tickets" USING btree ("sla_policy_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seed Phase 5 permissions (SLA_VIEW/SLA_MANAGE already seeded in Phase 1).
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("id", "key", "category", "description", "is_system") VALUES
  (gen_random_uuid(), 'business_hours.manage', 'sla', 'Create and edit business hours calendars.', true),
  (gen_random_uuid(), 'escalation.rule_manage', 'sla', 'Create and edit SLA escalation rules.', true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Owner = all permissions (re-grant to cover the new keys).
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'owner'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint

-- Supervisor gains the new SLA management perms (already had sla.view, sla.manage).
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.key IN ('business_hours.manage', 'escalation.rule_manage')
WHERE r.key = 'supervisor'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
-- Phase 6: Scoped API keys + audit hardening.
-- Adds scope columns, last IP/UA tracking, rotation/legacy compat fields
-- to api_keys. GIN indexes enable fast lookups on array columns.
-- Backfill: existing keys keep legacy "all permissions" behavior so they
-- continue to work; admins can opt in to scoping per key.

-- ---------------------------------------------------------------------------
-- api_keys: upgrade scopes column from text (added by 0050) to text[]
-- ---------------------------------------------------------------------------

-- Main's migration 0050_api_keys_scopes added "scopes" as plain text.
-- The ticketing RBAC model requires a native text[] array for GIN indexing
-- and direct array operations. Drop the text column and re-add as text[].
ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "scopes";
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api_keys: new columns
-- ---------------------------------------------------------------------------

ALTER TABLE "api_keys"
  ADD COLUMN IF NOT EXISTS "scopes" text[] DEFAULT '{}'::text[] NOT NULL,
  ADD COLUMN IF NOT EXISTS "allowed_team_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  ADD COLUMN IF NOT EXISTS "allowed_inbox_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  ADD COLUMN IF NOT EXISTS "last_ip" text,
  ADD COLUMN IF NOT EXISTS "last_user_agent" text,
  ADD COLUMN IF NOT EXISTS "rotated_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "compat_legacy_full_access" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "compat_acknowledged_at" timestamp with time zone;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GIN indexes for array containment lookups
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "api_keys_scopes_idx"
  ON "api_keys" USING gin ("scopes");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_allowed_team_ids_idx"
  ON "api_keys" USING gin ("allowed_team_ids");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_allowed_inbox_ids_idx"
  ON "api_keys" USING gin ("allowed_inbox_ids");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill: pre-existing keys retain "all permissions" semantics
-- ---------------------------------------------------------------------------

UPDATE "api_keys"
SET "compat_legacy_full_access" = true
WHERE "scopes" = '{}'::text[]
  AND "allowed_team_ids" = '{}'::text[]
  AND "allowed_inbox_ids" = '{}'::text[]
  AND "compat_acknowledged_at" IS NULL;
--> statement-breakpoint
-- Phase 7: ticket subscriptions + webhook delivery audit log.
-- Adds per-(ticket, principal) subscription rows mirroring post_subscriptions
-- with richer flags and a `mutedUntil` window. Adds an append-only audit
-- table for webhook delivery attempts (every dispatch outcome is logged).
-- Adds a nullable `ticket_id` to in_app_notifications for ticket events.

-- ---------------------------------------------------------------------------
-- ticket_subscriptions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ticket_subscriptions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "ticket_id" uuid NOT NULL,
  "principal_id" uuid NOT NULL,
  "notify_threads" boolean DEFAULT true NOT NULL,
  "notify_status" boolean DEFAULT true NOT NULL,
  "notify_assignment" boolean DEFAULT true NOT NULL,
  "notify_participants" boolean DEFAULT false NOT NULL,
  "notify_shares" boolean DEFAULT false NOT NULL,
  "notify_sla" boolean DEFAULT true NOT NULL,
  "muted_until" timestamp with time zone,
  "source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ticket_subscriptions_source_check"
    CHECK ("source" IN ('auto_assigned', 'auto_participant', 'auto_team_member', 'manual'))
);
--> statement-breakpoint

ALTER TABLE "ticket_subscriptions"
  ADD CONSTRAINT "ticket_subscriptions_ticket_id_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "ticket_subscriptions"
  ADD CONSTRAINT "ticket_subscriptions_principal_id_fk"
  FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ticket_subscriptions_unique"
  ON "ticket_subscriptions" ("ticket_id", "principal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_subscriptions_principal_idx"
  ON "ticket_subscriptions" ("principal_id", "ticket_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_subscriptions_ticket_threads_idx"
  ON "ticket_subscriptions" ("ticket_id") WHERE notify_threads = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_subscriptions_ticket_status_idx"
  ON "ticket_subscriptions" ("ticket_id") WHERE notify_status = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_subscriptions_ticket_assignment_idx"
  ON "ticket_subscriptions" ("ticket_id") WHERE notify_assignment = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_subscriptions_ticket_sla_idx"
  ON "ticket_subscriptions" ("ticket_id") WHERE notify_sla = true;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- webhook_deliveries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY NOT NULL,
  "webhook_id" uuid NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "attempt_number" integer NOT NULL,
  "status" text NOT NULL,
  "http_status" integer,
  "error_message" text,
  "request_url" text NOT NULL,
  "request_payload_bytes" integer NOT NULL,
  "response_body_snippet" text,
  "latency_ms" integer,
  "signature_timestamp" bigint NOT NULL,
  "attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "next_retry_at" timestamp with time zone,
  CONSTRAINT "webhook_deliveries_status_check"
    CHECK ("status" IN ('queued', 'success', 'failed_retryable', 'failed_terminal', 'blocked_ssrf'))
);
--> statement-breakpoint

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_webhook_id_fk"
  FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_attempted_idx"
  ON "webhook_deliveries" ("webhook_id", "attempted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_idx"
  ON "webhook_deliveries" ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_failed_idx"
  ON "webhook_deliveries" ("status", "attempted_at")
  WHERE status IN ('failed_retryable', 'failed_terminal');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- in_app_notifications: add nullable ticket_id for ticket-related events
-- ---------------------------------------------------------------------------

ALTER TABLE "in_app_notifications"
  ADD COLUMN IF NOT EXISTS "ticket_id" uuid;
--> statement-breakpoint

ALTER TABLE "in_app_notifications"
  ADD CONSTRAINT "in_app_notifications_ticket_id_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "in_app_notifications_ticket_idx"
  ON "in_app_notifications" ("ticket_id", "created_at");
-- Phase 5 (webhook operator surface): persist the request payload alongside
-- each webhook_deliveries row so the operator-facing redeliver action can
-- replay the exact payload that was originally POSTed.
--
-- `request_payload_json` holds the full event envelope as it appears on the
-- wire (`{id,type,createdAt,data}`). The writer caps stored payloads at
-- ~32 KB; oversized payloads are stored as NULL with the truncated flag set
-- and become non-redeliverable (rare for ticketing payloads).

ALTER TABLE "webhook_deliveries"
  ADD COLUMN IF NOT EXISTS "request_payload_json" jsonb;

ALTER TABLE "webhook_deliveries"
  ADD COLUMN IF NOT EXISTS "request_payload_truncated" boolean NOT NULL DEFAULT false;
-- Phase 4 (per-inbox webhook filtering): add an optional inbox filter to
-- the webhooks table mirroring the existing board_ids filter for posts.
--
-- Semantics:
--   inbox_ids IS NULL  OR  cardinality(inbox_ids) = 0  → match all inboxes
--   non-empty array                                    → only match ticket
--                                                       events whose
--                                                       data.ticket.inboxId
--                                                       is in the array.
--
-- Existing webhooks transparently match-all because the column is nullable.

ALTER TABLE "webhooks" ADD COLUMN IF NOT EXISTS "inbox_ids" text[];
-- Phase 6: GitHub ↔ Ticket bidirectional sync foundation
--
-- 1. Allow multiple integrations per type (multi-repo GitHub support)
-- 2. Add ticket_external_links table (mirrors post_external_links for tickets)
-- 3. Add integration_user_mappings table (GitHub username → team principal)

ALTER TABLE "integrations" DROP CONSTRAINT IF EXISTS "integration_type_unique";--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "label" varchar(100);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_external_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"integration_id" uuid,
	"integration_type" varchar(50) NOT NULL,
	"external_id" text NOT NULL,
	"external_display_id" text,
	"external_url" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"sync_direction" varchar(20) DEFAULT 'outbound' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_user_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"external_username" varchar(255) NOT NULL,
	"external_display_name" text,
	"principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_external_links" ADD CONSTRAINT "ticket_external_links_ticket_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_external_links" ADD CONSTRAINT "ticket_external_links_integration_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_user_mappings" ADD CONSTRAINT "integration_user_mappings_integration_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_user_mappings" ADD CONSTRAINT "integration_user_mappings_principal_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_external_links_type_external_ticket_unique" ON "ticket_external_links" USING btree ("integration_type","external_id","ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_external_links_ticket_id_idx" ON "ticket_external_links" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_external_links_type_external_id_idx" ON "ticket_external_links" USING btree ("integration_type","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_external_links_ticket_status_idx" ON "ticket_external_links" USING btree ("ticket_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_user_mappings_integration_username_unique" ON "integration_user_mappings" USING btree ("integration_id","external_username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_user_mappings_principal_idx" ON "integration_user_mappings" USING btree ("principal_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"ticket_id" uuid,
	"external_id" text,
	"event_type" text NOT NULL,
	"direction" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_sync_log" ADD CONSTRAINT "integration_sync_log_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_sync_log" ADD CONSTRAINT "integration_sync_log_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_sync_log_integration_created_idx" ON "integration_sync_log" USING btree ("integration_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_sync_log_ticket_created_idx" ON "integration_sync_log" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_sync_log_status_idx" ON "integration_sync_log" USING btree ("status","created_at") WHERE status = 'failed';