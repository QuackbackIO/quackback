-- Team invites can carry a custom-role grant: accept maps it onto
-- role='member' plus a workspace assignment. SET NULL on role deletion so a
-- pending invite falls back to its legacy role text alone.
ALTER TABLE "invitation" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;
