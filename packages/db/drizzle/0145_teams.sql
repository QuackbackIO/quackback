-- Teams (support platform §4.12): assignable groups of teammates for the
-- support inbox. Membership is a pure relationship separate from role; the
-- conversation assignee is polymorphic (team OR teammate, two independent
-- nullable columns with no clearing rule). A workspace seeds one is_default
-- team ("Support"); the app enforces at most one default. Existing teammates
-- are NOT auto-enrolled here (a single-team workspace behaves workspace-wide);
-- the principal factory enrolls new teammates going forward.
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"assignment_method" text DEFAULT 'manual' NOT NULL,
	"rr_cursor_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
-- Round-robin cursor points at a member; set null if that principal is deleted.
ALTER TABLE "teams"
	ADD CONSTRAINT "teams_rr_cursor_principal_id_fkey"
	FOREIGN KEY ("rr_cursor_principal_id") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- Default-team lookup, skipping soft-deleted rows.
CREATE INDEX "teams_is_default_idx" ON "teams" ("id") WHERE is_default = true AND deleted_at IS NULL;
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_members"
	ADD CONSTRAINT "team_members_team_id_fkey"
	FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "team_members"
	ADD CONSTRAINT "team_members_principal_id_fkey"
	FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE cascade;
--> statement-breakpoint
-- One membership per (team, principal). Columns alphabetical to match drizzle
-- introspection.
CREATE UNIQUE INDEX "team_members_principal_team_uq" ON "team_members" ("principal_id", "team_id");
--> statement-breakpoint
CREATE INDEX "team_members_team_idx" ON "team_members" ("team_id");
--> statement-breakpoint
-- Conversations gain a team assignee alongside the agent assignee. Independent
-- nullable column, set null so a deleted team leaves the row team-unassigned.
ALTER TABLE "conversations" ADD COLUMN "assigned_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "conversations"
	ADD CONSTRAINT "conversations_assigned_team_id_fkey"
	FOREIGN KEY ("assigned_team_id") REFERENCES "teams"("id") ON DELETE set null;
--> statement-breakpoint
-- Team inbox view: only team-assigned rows are indexed (partial).
CREATE INDEX "conversations_assigned_team_idx" ON "conversations" ("assigned_team_id") WHERE assigned_team_id IS NOT NULL;
--> statement-breakpoint
-- Retype principal_role_assignments.team_id from a plain uuid to a real FK to
-- teams (§4.12). The column is uuid already and all-NULL today, so this is a
-- pure ADD CONSTRAINT; team-scoped grants tear down with their team.
ALTER TABLE "principal_role_assignments"
	ADD CONSTRAINT "principal_role_assignments_team_id_teams_id_fk"
	FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade;
--> statement-breakpoint
-- Seed the single default team. gen_random_uuid() matches typeIdWithDefault's
-- storage (UUID); the app reads it back as a team_* TypeID.
INSERT INTO "teams" ("id", "name", "is_default", "assignment_method")
VALUES (gen_random_uuid(), 'Support', true, 'manual');
