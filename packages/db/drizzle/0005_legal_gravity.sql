CREATE TABLE "post_external_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"integration_type" varchar(50) NOT NULL,
	"external_id" text NOT NULL,
	"external_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_external_links_type_external_id" UNIQUE("integration_type","external_id")
);
--> statement-breakpoint
ALTER TABLE "post_external_links" ADD CONSTRAINT "post_external_links_post_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_external_links" ADD CONSTRAINT "post_external_links_integration_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_external_links_post_id_idx" ON "post_external_links" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_external_links_type_external_id_idx" ON "post_external_links" USING btree ("integration_type","external_id");