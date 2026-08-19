-- Imports & exports hub (§I1): one row per async import job. The worker owns
-- pending -> dry_run|running -> completed|failed and writes back totals + a
-- capped error report the hub polls and renders. batch_tag_id points at the
-- auto-tag ("import-{source}-{date}") applied to every post the run creates;
-- set null on tag delete so history survives losing its tag.
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"file_name" text NOT NULL,
	"initiated_by_principal_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"totals" jsonb,
	"error_report" jsonb,
	"batch_tag_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "import_runs"
	ADD CONSTRAINT "import_runs_initiated_by_principal_id_fkey"
	FOREIGN KEY ("initiated_by_principal_id") REFERENCES "principal"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "import_runs"
	ADD CONSTRAINT "import_runs_batch_tag_id_fkey"
	FOREIGN KEY ("batch_tag_id") REFERENCES "post_tags"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "import_runs_status_idx" ON "import_runs" ("status");
--> statement-breakpoint
CREATE INDEX "import_runs_created_at_idx" ON "import_runs" ("created_at");
