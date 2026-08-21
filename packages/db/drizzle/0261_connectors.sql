-- Agent Connectors: one row per remote MCP server. Identity, auth, cached
-- tool catalog, per-tool policies, per-agent availability, and health.
-- Secret material is encrypted at rest by the service (purpose
-- connector-secrets); the column stores ciphertext only.
CREATE TABLE IF NOT EXISTS "connectors" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "url" text NOT NULL,
  "auth_mode" text NOT NULL,
  "secrets" text,
  "status" text DEFAULT 'connected' NOT NULL,
  "tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tool_policies" jsonb DEFAULT '{"groupDefaults":{"read":"always","write":"approval"},"tools":{}}'::jsonb NOT NULL,
  "assignments" jsonb DEFAULT '{"agent":false,"copilot":false}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_synced_at" timestamp with time zone,
  "last_call_at" timestamp with time zone,
  "last_error" text,
  "last_error_at" timestamp with time zone,
  "error_count" integer DEFAULT 0 NOT NULL,
  "created_by_principal_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "connectors_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 80),
  CONSTRAINT "connectors_slug_length_check" CHECK (char_length("slug") BETWEEN 1 AND 20),
  CONSTRAINT "connectors_auth_mode_check" CHECK ("auth_mode" IN ('none', 'bearer', 'oauth')),
  CONSTRAINT "connectors_status_check" CHECK ("status" IN ('connected', 'error', 'disabled'))
);
--> statement-breakpoint
-- @replay: guarded-by IF NOT EXISTS on pg_constraint.conname = 'connectors_created_by_principal_id_principal_id_fk'; the block's
-- only action is adding that constraint, so a second run does nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'connectors_created_by_principal_id_principal_id_fk'
  ) THEN
    ALTER TABLE "connectors"
      ADD CONSTRAINT "connectors_created_by_principal_id_principal_id_fk"
      FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connectors_slug_lower_unique" ON "connectors" USING btree (lower("slug"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connectors_name_lower_unique" ON "connectors" USING btree (lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connectors_enabled_idx" ON "connectors" USING btree ("enabled");
--> statement-breakpoint
-- Packaged agent procedures. Skills are instructions, not capabilities.
CREATE TABLE IF NOT EXISTS "agent_skills" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "when_to_use" text NOT NULL,
  "instructions" text NOT NULL,
  "assignments" jsonb DEFAULT '{"agent":false,"copilot":false}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by_principal_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_skills_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 80),
  CONSTRAINT "agent_skills_when_to_use_length_check" CHECK (char_length("when_to_use") BETWEEN 1 AND 240),
  CONSTRAINT "agent_skills_instructions_length_check" CHECK (char_length("instructions") BETWEEN 1 AND 8000)
);
--> statement-breakpoint
-- @replay: guarded-by IF NOT EXISTS on pg_constraint.conname = 'agent_skills_created_by_principal_id_principal_id_fk'; the block's
-- only action is adding that constraint, so a second run does nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_skills_created_by_principal_id_principal_id_fk'
  ) THEN
    ALTER TABLE "agent_skills"
      ADD CONSTRAINT "agent_skills_created_by_principal_id_principal_id_fk"
      FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_skills_name_lower_unique" ON "agent_skills" USING btree (lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_enabled_idx" ON "agent_skills" USING btree ("enabled");
