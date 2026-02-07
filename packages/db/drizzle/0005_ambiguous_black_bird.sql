ALTER TABLE "posts" ADD COLUMN "canonical_post_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "merged_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_merged_by_member_id_member_id_fk" FOREIGN KEY ("merged_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_canonical_post_id_idx" ON "posts" USING btree ("canonical_post_id");