ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_created_by_id_principal_id_fk";
--> statement-breakpoint
DROP INDEX "principal_user_idx";--> statement-breakpoint
ALTER TABLE "principal" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "created_by_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "principal" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "principal" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "principal_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "principal_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_id_principal_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_principal_id_idx" ON "api_keys" USING btree ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_user_idx" ON "principal" USING btree ("user_id") WHERE user_id IS NOT NULL;--> statement-breakpoint
UPDATE "principal" SET display_name = u.name, avatar_url = u.image, avatar_key = u.image_key FROM "user" u WHERE "principal".user_id = u.id AND "principal".user_id IS NOT NULL AND "principal".display_name IS NULL;