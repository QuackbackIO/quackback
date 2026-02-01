CREATE TABLE "changelog_entry_posts" (
	"changelog_entry_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN "content_json" jsonb;--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN "member_id" uuid;--> statement-breakpoint
ALTER TABLE "changelog_entry_posts" ADD CONSTRAINT "changelog_entry_posts_changelog_entry_id_changelog_entries_id_fk" FOREIGN KEY ("changelog_entry_id") REFERENCES "public"."changelog_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entry_posts" ADD CONSTRAINT "changelog_entry_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_entry_posts_pk" ON "changelog_entry_posts" USING btree ("changelog_entry_id","post_id");--> statement-breakpoint
CREATE INDEX "changelog_entry_posts_changelog_id_idx" ON "changelog_entry_posts" USING btree ("changelog_entry_id");--> statement-breakpoint
CREATE INDEX "changelog_entry_posts_post_id_idx" ON "changelog_entry_posts" USING btree ("post_id");--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD CONSTRAINT "changelog_entries_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changelog_member_id_idx" ON "changelog_entries" USING btree ("member_id");