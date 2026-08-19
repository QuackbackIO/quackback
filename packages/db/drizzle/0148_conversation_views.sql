-- Custom saved inbox views + per-user pinning (support platform §4.6).
--
-- A conversation_view is a workspace-shared saved filter set: a serialized rule
-- set (status / assignee / team / priority / tags / channel-source / waiting)
-- plus a sort. Shared per the spec (is_shared default true), soft-deleted so a
-- removed view keeps history. created_by is a team actor (see REPOINT_EXEMPTIONS)
-- and set null on offboarding so a shared view outlives its creator.
CREATE TABLE "conversation_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"sort" text,
	"created_by_principal_id" uuid,
	"is_shared" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conversation_views"
	ADD CONSTRAINT "conversation_views_created_by_principal_id_fkey"
	FOREIGN KEY ("created_by_principal_id") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- Nav listing: shared, non-deleted views by name.
CREATE INDEX "conversation_views_shared_idx" ON "conversation_views" ("is_shared") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
-- Per-teammate pins: a tiny join table (per-user, so NOT a column on the view).
-- Composite PK makes a pin idempotent; both FKs cascade so a removed view or a
-- removed teammate drops its pins. principal_id is a team actor (exempt).
CREATE TABLE "conversation_view_pins" (
	"principal_id" uuid NOT NULL,
	"view_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_view_pins_pkey" PRIMARY KEY ("principal_id", "view_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_view_pins"
	ADD CONSTRAINT "conversation_view_pins_principal_id_fkey"
	FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "conversation_view_pins"
	ADD CONSTRAINT "conversation_view_pins_view_id_fkey"
	FOREIGN KEY ("view_id") REFERENCES "conversation_views"("id") ON DELETE cascade;
--> statement-breakpoint
-- Reverse lookup: everyone who pinned a given view (unpin fan-out, delete cleanup).
CREATE INDEX "conversation_view_pins_view_idx" ON "conversation_view_pins" ("view_id");
--> statement-breakpoint
-- Keyset indexes for the saved-view sorts (created / waiting) added alongside
-- views: each mirrors its ORDER BY (column + id tiebreak) so the sort pages
-- without a full scan. 'recent'/'oldest' already have 0139's last_message index.
CREATE INDEX IF NOT EXISTS conversations_created_at_id_idx ON conversations (created_at DESC, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS conversations_waiting_since_id_idx ON conversations (waiting_since ASC NULLS LAST, id);
