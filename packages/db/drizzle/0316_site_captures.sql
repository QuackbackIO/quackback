-- @contract: additive
-- Captures of brands' websites for the portal designer's brand match, one row
-- per host (the newest capture or failure), and a log of every call made to
-- the capture service, which the usage limits count.
CREATE TABLE IF NOT EXISTS "site_captures" (
  "host" text PRIMARY KEY NOT NULL,
  "url" text NOT NULL,
  "status" text NOT NULL
    CONSTRAINT "site_captures_status_check" CHECK ("status" IN ('ok', 'failed')),
  "reason" text,
  "image_key" text,
  "width" integer,
  "height" integer,
  "facts" jsonb,
  "assets" jsonb,
  "options" jsonb NOT NULL,
  "captured_by_principal_id" uuid
    CONSTRAINT "site_captures_captured_by_principal_id_principal_id_fk"
    REFERENCES "principal"("id") ON DELETE SET NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_capture_calls" (
  "id" uuid PRIMARY KEY NOT NULL,
  "host" text NOT NULL,
  "principal_id" uuid
    CONSTRAINT "site_capture_calls_principal_id_principal_id_fk"
    REFERENCES "principal"("id") ON DELETE SET NULL,
  "outcome" text NOT NULL,
  "billed" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_capture_calls_created_at_idx"
  ON "site_capture_calls" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_capture_calls_principal_created_idx"
  ON "site_capture_calls" ("principal_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_capture_calls_host_created_idx"
  ON "site_capture_calls" ("host", "created_at");
