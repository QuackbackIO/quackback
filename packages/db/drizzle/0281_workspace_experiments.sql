-- @contract: additive
-- Labs: one row per workspace and registered experiment. Missing rows mean
-- both visible and enabled are false. Hiding does not disable.
CREATE TABLE IF NOT EXISTS "workspace_experiments" (
  "settings_id" uuid NOT NULL,
  "experiment_id" text NOT NULL,
  "visible" boolean NOT NULL DEFAULT false,
  "enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_experiments_pkey" PRIMARY KEY ("settings_id", "experiment_id"),
  CONSTRAINT "workspace_experiments_settings_id_settings_id_fk"
    FOREIGN KEY ("settings_id") REFERENCES "settings"("id") ON DELETE CASCADE
);
