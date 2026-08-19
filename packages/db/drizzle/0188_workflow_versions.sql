-- Workflow version history + rollback (support platform §4.6). One row per
-- meaningful save (workflow.service.ts writes a version on createWorkflow and
-- on every updateWorkflow patch that actually touches name/triggerType/
-- triggerSettings/graph — a no-op save, e.g. sortOrder-only, writes nothing).
-- Deliberately bounded, not a permanent audit log: the service prunes each
-- workflow down to its newest 50 versions after every insert. cascade on
-- workflow_id: a version snapshot is meaningless once its workflow is gone
-- (soft-deletes never hard-delete the workflow row, so this only fires on a
-- genuine hard delete). set null on created_by: a removed author leaves the
-- version, not an orphan (mirrors workflows.created_by).
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_settings" jsonb NOT NULL,
	"graph" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_versions"
	ADD CONSTRAINT "workflow_versions_workflow_id_fkey"
	FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "workflow_versions"
	ADD CONSTRAINT "workflow_versions_created_by_fkey"
	FOREIGN KEY ("created_by") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- The history sheet's hot read: a workflow's versions, newest first.
CREATE INDEX "workflow_versions_workflow_created_idx"
	ON "workflow_versions" ("workflow_id", "created_at" DESC);
