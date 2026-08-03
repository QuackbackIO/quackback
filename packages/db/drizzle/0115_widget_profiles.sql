CREATE TABLE IF NOT EXISTS "widget_applications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "widget_environment_profiles" (
  "id" uuid PRIMARY KEY NOT NULL,
  "application_id" uuid NOT NULL,
  "environment" text NOT NULL,
  "display_name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "config_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "content_filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "support_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "widget_environment_profiles"
    ADD CONSTRAINT "widget_environment_profiles_application_id_widget_applications_id_fk"
    FOREIGN KEY ("application_id") REFERENCES "public"."widget_applications"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "widget_applications_key_idx"
  ON "widget_applications" USING btree ("key");
CREATE INDEX IF NOT EXISTS "widget_applications_archived_at_idx"
  ON "widget_applications" USING btree ("archived_at");
CREATE INDEX IF NOT EXISTS "widget_profiles_application_idx"
  ON "widget_environment_profiles" USING btree ("application_id");
CREATE INDEX IF NOT EXISTS "widget_profiles_environment_idx"
  ON "widget_environment_profiles" USING btree ("environment");
CREATE INDEX IF NOT EXISTS "widget_profiles_enabled_idx"
  ON "widget_environment_profiles" USING btree ("enabled");
CREATE INDEX IF NOT EXISTS "widget_profiles_archived_at_idx"
  ON "widget_environment_profiles" USING btree ("archived_at");
CREATE UNIQUE INDEX IF NOT EXISTS "widget_profiles_application_environment_active_idx"
  ON "widget_environment_profiles" USING btree ("application_id", "environment")
  WHERE archived_at IS NULL;

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "source_widget_profile_id" uuid;

DO $$ BEGIN
  ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_source_widget_profile_id_widget_environment_profiles_id_fk"
    FOREIGN KEY ("source_widget_profile_id") REFERENCES "public"."widget_environment_profiles"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "tickets_source_widget_profile_idx"
  ON "tickets" USING btree ("source_widget_profile_id");
