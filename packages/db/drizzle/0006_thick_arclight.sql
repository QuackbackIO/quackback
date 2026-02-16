ALTER TABLE "posts" DROP CONSTRAINT "posts_official_response_principal_id_principal_id_fk";
--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "official_response";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "official_response_principal_id";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "official_response_at";