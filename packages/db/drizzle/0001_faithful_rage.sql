ALTER TABLE "workspace_domain" ADD COLUMN "cloudflare_hostname_id" text;--> statement-breakpoint
ALTER TABLE "workspace_domain" ADD COLUMN "ssl_status" text;--> statement-breakpoint
ALTER TABLE "workspace_domain" ADD COLUMN "ownership_status" text;--> statement-breakpoint
CREATE INDEX "workspace_domain_cf_hostname_id_idx" ON "workspace_domain" USING btree ("cloudflare_hostname_id");