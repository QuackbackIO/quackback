CREATE TABLE "segments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'manual' NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"rules" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_segments" (
	"principal_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"added_by" text DEFAULT 'manual' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_segments" ADD CONSTRAINT "user_segments_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_segments" ADD CONSTRAINT "user_segments_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "segments_type_idx" ON "segments" USING btree ("type");
--> statement-breakpoint
CREATE INDEX "segments_deleted_at_idx" ON "segments" USING btree ("deleted_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "user_segments_pk" ON "user_segments" USING btree ("principal_id","segment_id");
--> statement-breakpoint
CREATE INDEX "user_segments_principal_id_idx" ON "user_segments" USING btree ("principal_id");
--> statement-breakpoint
CREATE INDEX "user_segments_segment_id_idx" ON "user_segments" USING btree ("segment_id");
