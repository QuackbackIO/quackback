-- Imports & exports hub: one row per async workspace data export. An admin
-- clicks "Export workspace data"; the worker zips every core entity
-- (CSV/JSONL + manifest) into S3 and writes back size + per-entity counts the
-- hub polls and renders. expires_at gates downloads (finished_at + retention);
-- the worker deletes the row + object once past it.
CREATE TABLE "export_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_name" text NOT NULL,
	"s3_key" text,
	"size_bytes" integer,
	"entity_counts" jsonb,
	"error" text,
	"initiated_by_principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "export_runs"
	ADD CONSTRAINT "export_runs_initiated_by_principal_id_fkey"
	FOREIGN KEY ("initiated_by_principal_id") REFERENCES "principal"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "export_runs_status_idx" ON "export_runs" ("status");
--> statement-breakpoint
CREATE INDEX "export_runs_created_at_idx" ON "export_runs" ("created_at");
--> statement-breakpoint
-- At most one active (pending/running) export per deployment: a second click
-- while a run is in flight conflicts on this constant-expression index.
CREATE UNIQUE INDEX "export_runs_active_idx" ON "export_runs" ((1)) WHERE "status" IN ('pending', 'running');
