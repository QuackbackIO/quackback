-- User tags: lightweight admin-applied labels for portal people, mirroring
-- the post_tags pattern (unique name + color + soft delete, join table with
-- both FKs cascading). Unlike segments, tags carry no membership rules —
-- assignment is always explicit.
CREATE TABLE "user_tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "user_tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_tag_assignments" (
	"principal_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_tag_assignments"
	ADD CONSTRAINT "user_tag_assignments_principal_id_fk"
	FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "user_tag_assignments"
	ADD CONSTRAINT "user_tag_assignments_tag_id_fk"
	FOREIGN KEY ("tag_id") REFERENCES "user_tags"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_tag_assignments_pk" ON "user_tag_assignments" ("principal_id", "tag_id");
--> statement-breakpoint
CREATE INDEX "user_tag_assignments_tag_id_idx" ON "user_tag_assignments" ("tag_id");
--> statement-breakpoint
CREATE INDEX "user_tags_deleted_at_idx" ON "user_tags" ("deleted_at");
