-- Third-party app platform (EVENTING-V2 §3.6 / WO-12). An "app" is the unit of
-- third-party extension: an OAuth 2.1 client (Quackback is already a spec
-- compliant authorization server) + the capability scopes it was granted + an
-- optional signed webhook endpoint + the event types it subscribes to. This
-- replaces the hardcoded first-party integration Map as the extension point:
-- subscription authorization becomes a scope check against the shared vocabulary
-- (a catalogue event's requiredScope must be within the app's granted_scopes),
-- and delivery reuses the existing webhook HookHandler + safeFetch.
CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,                       -- TypeID 'app_...'
	"oauth_client_id" text NOT NULL,                      -- FK to the better-auth oauth client
	"name" text NOT NULL,
	"granted_scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"webhook_endpoint" text,
	"webhook_secret_enc" text,                            -- encrypted at rest (integrations/encryption)
	"subscribed_event_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,              -- 'active' | 'disabled'
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One app per oauth client.
CREATE UNIQUE INDEX "apps_oauth_client_id_idx" ON "apps" USING btree ("oauth_client_id");
--> statement-breakpoint
-- The app-webhook resolver scans active apps whose subscription includes the
-- event type; a partial-on-status + GIN on the array serves it.
CREATE INDEX "apps_status_idx" ON "apps" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "apps_subscribed_events_idx" ON "apps" USING gin ("subscribed_event_types");
