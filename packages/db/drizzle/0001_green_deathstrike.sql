ALTER TABLE "comments" DROP CONSTRAINT "comments_member_id_member_id_fk";
--> statement-breakpoint
ALTER TABLE "post_notes" DROP CONSTRAINT "post_notes_member_id_member_id_fk";
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_member_id_member_id_fk";
--> statement-breakpoint
DROP INDEX "posts_owner_id_idx";--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "member_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "post_notes" ALTER COLUMN "member_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "member_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_notes" ADD CONSTRAINT "post_notes_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN "author_id";--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN "author_name";--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN "author_email";--> statement-breakpoint
ALTER TABLE "post_notes" DROP COLUMN "author_name";--> statement-breakpoint
ALTER TABLE "post_notes" DROP COLUMN "author_email";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "author_id";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "author_name";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "author_email";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "owner_id";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "official_response_author_id";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "official_response_author_name";