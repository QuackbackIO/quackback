ALTER TABLE "integration_event_mappings" DROP CONSTRAINT "mapping_unique";--> statement-breakpoint
ALTER TABLE "post_external_links" DROP CONSTRAINT "post_external_links_type_external_id";--> statement-breakpoint
ALTER TABLE "post_external_links" ALTER COLUMN "integration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "source_type" varchar(40);--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "source_external_url" text;--> statement-breakpoint
ALTER TABLE "integration_event_mappings" ADD COLUMN "target_key" varchar(100) DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX "votes_source_type_idx" ON "votes" USING btree ("source_type") WHERE source_type IS NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_event_mappings" ADD CONSTRAINT "mapping_unique" UNIQUE("integration_id","event_type","action_type","target_key");--> statement-breakpoint
ALTER TABLE "post_external_links" ADD CONSTRAINT "post_external_links_type_external_post_unique" UNIQUE("integration_type","external_id","post_id");