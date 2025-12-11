-- Migration: Integrations v2
-- Drop minimal integrations table, create full integration schema

-- Drop old table (empty, safe to drop)
DROP TABLE IF EXISTS "integrations";

-- Organization integration configurations
CREATE TABLE "organization_integrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "integration_type" varchar(50) NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "access_token_encrypted" text,
  "refresh_token_encrypted" text,
  "token_expires_at" timestamp with time zone,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "external_workspace_id" varchar(255),
  "external_workspace_name" varchar(255),
  "connected_by_member_id" text REFERENCES "member"("id"),
  "connected_at" timestamp with time zone,
  "last_sync_at" timestamp with time zone,
  "last_error" text,
  "last_error_at" timestamp with time zone,
  "error_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "org_integration_unique" UNIQUE("organization_id", "integration_type")
);

-- Event-to-action mappings
CREATE TABLE "integration_event_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "integration_id" uuid NOT NULL REFERENCES "organization_integrations"("id") ON DELETE CASCADE,
  "event_type" varchar(100) NOT NULL,
  "action_type" varchar(50) NOT NULL,
  "action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "filters" jsonb,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mapping_unique" UNIQUE("integration_id", "event_type", "action_type")
);

-- Linked entities for two-way sync
CREATE TABLE "integration_linked_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "integration_id" uuid NOT NULL REFERENCES "organization_integrations"("id") ON DELETE CASCADE,
  "entity_type" varchar(50) NOT NULL,
  "entity_id" uuid NOT NULL,
  "external_entity_type" varchar(50) NOT NULL,
  "external_entity_id" varchar(255) NOT NULL,
  "external_entity_url" text,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "linked_entity_unique" UNIQUE("integration_id", "entity_type", "entity_id")
);

-- Sync audit log
CREATE TABLE "integration_sync_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "integration_id" uuid NOT NULL REFERENCES "organization_integrations"("id") ON DELETE CASCADE,
  "event_id" uuid,
  "event_type" varchar(100) NOT NULL,
  "action_type" varchar(50) NOT NULL,
  "status" varchar(20) NOT NULL,
  "error_message" text,
  "duration_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX "idx_org_integrations_org" ON "organization_integrations" ("organization_id");
CREATE INDEX "idx_org_integrations_type_status" ON "organization_integrations" ("integration_type", "status");
CREATE INDEX "idx_event_mappings_lookup" ON "integration_event_mappings" ("integration_id", "event_type", "enabled");
CREATE INDEX "idx_linked_entities_lookup" ON "integration_linked_entities" ("integration_id", "entity_type", "entity_id");
CREATE INDEX "idx_sync_log_integration_created" ON "integration_sync_log" ("integration_id", "created_at" DESC);

-- RLS policies
ALTER TABLE "organization_integrations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_integrations_isolation" ON "organization_integrations"
  FOR ALL TO "app_user"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
