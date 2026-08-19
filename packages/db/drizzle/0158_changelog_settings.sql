-- Changelog Settings (§2): categories (labels) with per-category segment
-- gating, the entry <-> category M:N link, and the dedicated subscriber
-- model that replaces (additively) the linked-post-only subscriber source.
CREATE TABLE "changelog_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_category_name_lower_idx" ON "changelog_categories" USING btree (lower("name"));
--> statement-breakpoint
CREATE INDEX "changelog_category_position_idx" ON "changelog_categories" USING btree ("position");
--> statement-breakpoint
CREATE TABLE "changelog_entry_categories" (
	"changelog_entry_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "changelog_entry_categories_pk" PRIMARY KEY("changelog_entry_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "changelog_entry_categories" ADD CONSTRAINT "changelog_entry_categories_entry_fk" FOREIGN KEY ("changelog_entry_id") REFERENCES "public"."changelog_entries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "changelog_entry_categories" ADD CONSTRAINT "changelog_entry_categories_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."changelog_categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "changelog_entry_categories_category_idx" ON "changelog_entry_categories" USING btree ("category_id");
--> statement-breakpoint
CREATE TABLE "changelog_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"principal_id" uuid NOT NULL,
	"source" text NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changelog_subscriptions" ADD CONSTRAINT "changelog_subscriptions_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_subscriptions_principal_idx" ON "changelog_subscriptions" USING btree ("principal_id");
