-- Post activity log: tracks all meaningful state changes on posts
CREATE TABLE "post_activity" (
  "id" uuid PRIMARY KEY NOT NULL,
  "post_id" uuid NOT NULL,
  "principal_id" uuid,
  "type" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_activity"
  ADD CONSTRAINT "post_activity_post_id_posts_id_fk"
  FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "post_activity"
  ADD CONSTRAINT "post_activity_principal_id_principal_id_fk"
  FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "post_activity_post_id_created_idx"
  ON "post_activity" USING btree ("post_id", "created_at");
--> statement-breakpoint
CREATE INDEX "post_activity_type_idx"
  ON "post_activity" USING btree ("type");
