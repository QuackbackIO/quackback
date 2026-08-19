ALTER TABLE "roadmaps" ADD COLUMN "type" text DEFAULT 'column' NOT NULL;
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD COLUMN "base_filter" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD COLUMN "date_source" text;
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD COLUMN "frequency" text;
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD COLUMN "visible_segment_ids" jsonb;
--> statement-breakpoint

ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_type_check"
  CHECK ("type" IN ('column', 'date'));
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_date_source_check"
  CHECK ("date_source" IS NULL OR "date_source" = 'eta');
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_frequency_check"
  CHECK ("frequency" IS NULL OR "frequency" IN ('monthly', 'quarterly', 'semiannual'));
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_visibility_check"
  CHECK ("visibility" IN ('public', 'team', 'segment'));
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_base_filter_object_check"
  CHECK (jsonb_typeof("base_filter") = 'object');
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_visible_segment_ids_array_check"
  CHECK ("visible_segment_ids" IS NULL OR jsonb_typeof("visible_segment_ids") = 'array');
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_type_config_check"
  CHECK (
    ("type" = 'column' AND "date_source" IS NULL AND "frequency" IS NULL)
    OR
    ("type" = 'date' AND "date_source" = 'eta' AND "frequency" IS NOT NULL)
  );
--> statement-breakpoint

UPDATE "roadmaps"
SET
  "type" = 'column',
  "base_filter" = '{}'::jsonb,
  "date_source" = NULL,
  "frequency" = NULL,
  "visibility" = CASE WHEN "is_public" THEN 'public' ELSE 'team' END,
  "visible_segment_ids" = NULL;
--> statement-breakpoint

CREATE TABLE "roadmap_columns" (
  "id" uuid PRIMARY KEY NOT NULL,
  "roadmap_id" uuid NOT NULL,
  "status_id" uuid NOT NULL,
  "name" text NOT NULL,
  "icon" text,
  "color" text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roadmap_columns" ADD CONSTRAINT "roadmap_columns_roadmap_id_roadmaps_id_fk"
  FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "roadmap_columns" ADD CONSTRAINT "roadmap_columns_status_id_post_statuses_id_fk"
  FOREIGN KEY ("status_id") REFERENCES "public"."post_statuses"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "roadmap_columns_roadmap_status_unique"
  ON "roadmap_columns" USING btree ("roadmap_id", "status_id");
--> statement-breakpoint
CREATE INDEX "roadmap_columns_roadmap_position_idx"
  ON "roadmap_columns" USING btree ("roadmap_id", "position");
--> statement-breakpoint
CREATE INDEX "roadmap_columns_status_id_idx"
  ON "roadmap_columns" USING btree ("status_id");
--> statement-breakpoint
CREATE INDEX "roadmaps_visibility_idx" ON "roadmaps" USING btree ("visibility");
--> statement-breakpoint

INSERT INTO "roadmap_columns" ("id", "roadmap_id", "status_id", "name", "color", "position")
SELECT gen_random_uuid(), r."id", s."id", s."name", s."color",
       row_number() OVER (PARTITION BY r."id" ORDER BY s."category", s."position", s."id") - 1
FROM "roadmaps" r
CROSS JOIN "post_statuses" s
WHERE r."deleted_at" IS NULL
  AND s."deleted_at" IS NULL
  AND s."show_on_roadmap" = true;
