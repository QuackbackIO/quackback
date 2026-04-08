CREATE TABLE "kb_domain_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"settings_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cname_target" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_articles" ALTER COLUMN "embedding" SET DATA TYPE vector(768);--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "help_center_config" text;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "kb_categories" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "kb_categories" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "kb_domain_verifications" ADD CONSTRAINT "kb_domain_verifications_settings_id_settings_id_fk" FOREIGN KEY ("settings_id") REFERENCES "public"."settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_domain_verifications_settings_id_idx" ON "kb_domain_verifications" USING btree ("settings_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_domain_verifications_domain_idx" ON "kb_domain_verifications" USING btree ("domain");--> statement-breakpoint
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_parent_id_kb_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."kb_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_articles_category_position_idx" ON "kb_articles" USING btree ("category_id","position");--> statement-breakpoint
CREATE INDEX "kb_categories_parent_id_idx" ON "kb_categories" USING btree ("parent_id");