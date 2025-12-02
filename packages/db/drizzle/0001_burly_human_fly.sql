ALTER TABLE "organization" ADD COLUMN "strict_sso_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "member_id" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "member_id" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "owner_member_id" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "official_response_member_id" text;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_owner_member_id_member_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_official_response_member_id_member_id_fk" FOREIGN KEY ("official_response_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_member_id_idx" ON "comments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "posts_member_id_idx" ON "posts" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "posts_owner_member_id_idx" ON "posts" USING btree ("owner_member_id");