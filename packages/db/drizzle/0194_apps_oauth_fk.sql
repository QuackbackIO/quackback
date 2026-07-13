-- Bind each app to its live better-auth OAuth client (EVENTING-V2 WO-12
-- follow-up). Deleting the oauth_client now cascades to the app, so a revoked
-- client can never leave an orphaned app row still receiving webhooks.
--
-- Shipped as its own migration (not folded into 0193): 0193 is already applied
-- in existing databases and applied migrations never re-run.

-- Defensive: drop any app row whose client is already gone, so the constraint
-- always applies cleanly (same end state the cascade would have produced).
DELETE FROM "apps" WHERE "oauth_client_id" NOT IN (SELECT "client_id" FROM "oauth_client");
--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_oauth_client_id_oauth_client_client_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;
