ALTER TABLE "settings" ADD COLUMN "widget_installed_first_seen_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "widget_installed_last_seen_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "widget_installed_origin_host" text;
