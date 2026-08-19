ALTER TABLE "settings" ADD COLUMN "assistant_config" jsonb;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "assistant_config_revision" integer;
--> statement-breakpoint
DO $$
DECLARE
  row_record RECORD;
  metadata_json jsonb;
  widget_json jsonb;
  legacy_basics jsonb;
  legacy_surfaces jsonb;
  legacy_controls jsonb;
  legacy_identity jsonb;
  normalized_controls jsonb;
  assistant_name text;
  assistant_avatar text;
  global_instructions text;
  widget_instructions text;
  email_instructions text;
  next_channels jsonb;
  next_widget_assistant jsonb;
BEGIN
  FOR row_record IN SELECT id, metadata, widget_config FROM settings LOOP
    BEGIN
      metadata_json := COALESCE(row_record.metadata::jsonb, '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'settings row % has invalid metadata JSON; legacy assistant metadata could not be migrated', row_record.id;
      metadata_json := '{}'::jsonb;
    END;

    BEGIN
      widget_json := COALESCE(row_record.widget_config::jsonb, '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'settings row % has invalid widget_config JSON; legacy assistant identity could not be migrated', row_record.id;
      widget_json := '{}'::jsonb;
    END;

    legacy_basics := CASE
      WHEN jsonb_typeof(metadata_json->'assistantBasics') = 'object' THEN metadata_json->'assistantBasics'
      ELSE '{}'::jsonb
    END;
    legacy_surfaces := CASE
      WHEN jsonb_typeof(metadata_json->'assistantSurfaces') = 'object' THEN metadata_json->'assistantSurfaces'
      ELSE '{}'::jsonb
    END;
    legacy_controls := CASE
      WHEN jsonb_typeof(metadata_json->'assistantToolControls') = 'object' THEN metadata_json->'assistantToolControls'
      ELSE '{}'::jsonb
    END;
    legacy_identity := CASE
      WHEN jsonb_typeof(widget_json#>'{messenger,assistant}') = 'object' THEN widget_json#>'{messenger,assistant}'
      ELSE '{}'::jsonb
    END;

    SELECT COALESCE(
      jsonb_object_agg(
        key,
        CASE
          WHEN key IN ('set_attribute', 'end_conversation', 'create_ticket', 'capture_feedback')
            AND value = 'autonomous' THEN 'approval'
          ELSE value
        END
      ),
      '{}'::jsonb
    )
      INTO normalized_controls
      FROM jsonb_each_text(legacy_controls)
      WHERE value IN ('disabled', 'approval', 'autonomous');

    assistant_name := btrim(COALESCE(legacy_identity->>'name', ''));
    IF assistant_name = '' THEN
      assistant_name := 'Quinn';
    ELSIF char_length(assistant_name) > 80 THEN
      RAISE WARNING 'settings row % has an assistant name over 80 characters; reset to Quinn', row_record.id;
      assistant_name := 'Quinn';
    END IF;

    assistant_avatar := btrim(COALESCE(legacy_identity->>'avatarUrl', ''));
    IF assistant_avatar <> '' AND assistant_avatar !~* '^https?://[^[:space:]]+$' THEN
      RAISE WARNING 'settings row % has an invalid assistant avatar URL; migrated as null', row_record.id;
      assistant_avatar := '';
    ELSIF char_length(assistant_avatar) > 2000 THEN
      RAISE WARNING 'settings row % has an assistant avatar URL over 2000 characters; migrated as null', row_record.id;
      assistant_avatar := '';
    END IF;

    global_instructions := btrim(COALESCE(legacy_surfaces#>>'{global,instructions}', ''));
    widget_instructions := btrim(COALESCE(legacy_surfaces#>>'{widget,instructions}', ''));
    email_instructions := btrim(COALESCE(legacy_surfaces#>>'{email,instructions}', ''));

    IF char_length(global_instructions) > 2000 THEN
      RAISE WARNING 'settings row % has global assistant instructions over 2000 characters; migrated as empty', row_record.id;
      global_instructions := '';
    END IF;
    IF char_length(widget_instructions) > 1000 THEN
      RAISE WARNING 'settings row % has widget assistant instructions over 1000 characters; migrated as empty', row_record.id;
      widget_instructions := '';
    END IF;
    IF char_length(email_instructions) > 1000 THEN
      RAISE WARNING 'settings row % has email assistant instructions over 1000 characters; migrated as empty', row_record.id;
      email_instructions := '';
    END IF;

    next_channels := '{}'::jsonb;
    IF widget_instructions <> '' THEN
      next_channels := next_channels || jsonb_build_object(
        'widget', jsonb_build_object('additionalInstructions', widget_instructions)
      );
    END IF;
    IF email_instructions <> '' THEN
      next_channels := next_channels || jsonb_build_object(
        'email', jsonb_build_object('additionalInstructions', email_instructions)
      );
    END IF;

    next_widget_assistant := '{}'::jsonb;
    IF jsonb_typeof(legacy_identity->'enabled') = 'boolean' THEN
      next_widget_assistant := next_widget_assistant || jsonb_build_object('enabled', legacy_identity->'enabled');
    END IF;
    IF jsonb_typeof(legacy_identity->'respond') = 'boolean' THEN
      next_widget_assistant := next_widget_assistant || jsonb_build_object('respond', legacy_identity->'respond');
    END IF;

    UPDATE settings
    SET
      assistant_config = jsonb_build_object(
        'version', 2,
        'identity', jsonb_build_object(
          'name', assistant_name,
          'avatarUrl', CASE WHEN assistant_avatar = '' THEN 'null'::jsonb ELSE to_jsonb(assistant_avatar) END,
          'showAiLabel', CASE
            WHEN jsonb_typeof(legacy_identity->'showAiLabel') = 'boolean'
              THEN (legacy_identity->>'showAiLabel')::boolean
            ELSE true
          END
        ),
        'voice', jsonb_build_object(
          'tone', CASE legacy_basics->>'tone'
            WHEN 'friendly' THEN 'warm'
            WHEN 'professional' THEN 'professional'
            ELSE 'balanced'
          END,
          'responseLength', CASE legacy_basics->>'length'
            WHEN 'concise' THEN 'brief'
            WHEN 'thorough' THEN 'detailed'
            ELSE 'balanced'
          END,
          'additionalInstructions', global_instructions
        ),
        'channels', next_channels,
        'toolControls', normalized_controls
      ),
      assistant_config_revision = 1,
      metadata = (metadata_json - 'assistantBasics' - 'assistantSurfaces' - 'assistantToolControls')::text,
      widget_config = (
        widget_json || jsonb_build_object(
          'messenger', COALESCE(widget_json->'messenger', '{}'::jsonb) || jsonb_build_object(
            'assistant', next_widget_assistant
          )
        )
      )::text
    WHERE id = row_record.id;
  END LOOP;
END $$;
--> statement-breakpoint
UPDATE "principal"
SET
  "display_name" = (SELECT "assistant_config"->'identity'->>'name' FROM "settings" LIMIT 1),
  "avatar_url" = (SELECT "assistant_config"->'identity'->>'avatarUrl' FROM "settings" LIMIT 1)
WHERE "type" = 'service'
  AND "service_metadata"->>'kind' = 'integration'
  AND "service_metadata"->>'integrationType' = 'assistant';
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "assistant_config" SET DEFAULT '{"version":2,"identity":{"name":"Quinn","avatarUrl":null,"showAiLabel":true},"voice":{"tone":"balanced","responseLength":"balanced","additionalInstructions":""},"channels":{},"toolControls":{}}'::jsonb;
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "assistant_config" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "assistant_config_revision" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "assistant_config_revision" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions" ADD COLUMN "origin_role" text DEFAULT 'customer_support' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "assistant_guidance_rules_enabled_position_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "assistant_guidance_rules_category_position_idx";
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" DROP CONSTRAINT IF EXISTS "assistant_guidance_rules_title_length_check";
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" DROP CONSTRAINT IF EXISTS "assistant_guidance_rules_body_length_check";
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" RENAME COLUMN "title" TO "name";
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" RENAME COLUMN "body" TO "instruction";
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" RENAME COLUMN "surfaces" TO "channels";
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" RENAME COLUMN "position" TO "priority";
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" ADD COLUMN "applies_when" text;
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" ADD COLUMN "roles" text[] DEFAULT ARRAY['customer_support', 'suggested_reply']::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" DROP COLUMN "category";
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" ADD CONSTRAINT "assistant_guidance_rules_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 80);
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" ADD CONSTRAINT "assistant_guidance_rules_applies_when_length_check" CHECK ("applies_when" IS NULL OR char_length("applies_when") BETWEEN 1 AND 500);
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" ADD CONSTRAINT "assistant_guidance_rules_instruction_length_check" CHECK (char_length("instruction") BETWEEN 1 AND 1000);
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" ADD CONSTRAINT "assistant_guidance_rules_roles_length_check" CHECK (cardinality("roles") BETWEEN 1 AND 3);
--> statement-breakpoint
CREATE INDEX "assistant_guidance_rules_enabled_priority_idx" ON "assistant_guidance_rules" USING btree ("enabled", "priority");
