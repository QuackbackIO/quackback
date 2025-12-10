DROP INDEX "user_email_org_unique_idx";--> statement-breakpoint
DROP INDEX "user_organization_id_idx";--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_user_org_idx" ON "member" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_org_idx" ON "user" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "user_org_id_idx" ON "user" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "strict_sso_mode";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "portal_voting";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "portal_commenting";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "portal_submissions";