ALTER TABLE "comments" ADD COLUMN "status_change_from_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "status_change_to_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "is_comments_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_status_change_from_id_post_statuses_id_fk" FOREIGN KEY ("status_change_from_id") REFERENCES "public"."post_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_status_change_to_id_post_statuses_id_fk" FOREIGN KEY ("status_change_to_id") REFERENCES "public"."post_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "telemetry_config";