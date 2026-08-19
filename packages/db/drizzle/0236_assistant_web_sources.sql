-- Assistant web sources: public pages an admin adds by URL for Quinn to
-- ground answers on. The crawled text (extracted at add time through the
-- SSRF guard) is what retrieval searches; the original URL is what a
-- citation links back to. Content is public by construction, so there is no
-- audience tier. TypeIDs are stored as native uuid, matching every other
-- table.
CREATE TABLE "assistant_web_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_web_sources"
	ADD CONSTRAINT "assistant_web_sources_created_by_id_principal_id_fk"
	FOREIGN KEY ("created_by_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_web_sources_url_uidx" ON "assistant_web_sources" USING btree ("url");
--> statement-breakpoint
CREATE INDEX "assistant_web_sources_enabled_idx" ON "assistant_web_sources" USING btree ("enabled");
