-- Macros (support platform §4.6): canned replies upgraded to text-with-variables
-- plus bundled actions, scoped support/feedback/both. Supersedes the old
-- settings-JSON `messenger.cannedReplies`; existing replies are copied in below.
-- `created_by_principal_id` is a team actor (SET NULL on delete so removing the
-- author never drops the macro), exempt from the principal re-point.
CREATE TABLE "macros" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"scope" text DEFAULT 'support' NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "macros"
	ADD CONSTRAINT "macros_created_by_principal_id_principal_id_fk"
	FOREIGN KEY ("created_by_principal_id") REFERENCES "principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Safe reader for the settings.widget_config text column: NULL for NULL, blank
-- or unparseable content, so one hand-edited or corrupt blob is skipped instead
-- of aborting the whole upgrade. Session-scoped; gone when the migration
-- session ends.
CREATE OR REPLACE FUNCTION pg_temp._m0146_widget_json(raw text) RETURNS jsonb AS $$
BEGIN
	IF raw IS NULL OR btrim(raw) = '' THEN RETURN NULL; END IF;
	RETURN raw::jsonb;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Data migration: copy each well-formed canned reply (title + body both set)
-- from settings.widget_config JSON into a support-scoped macro with no actions.
-- The CASE guards a null/empty/unreadable widget_config so the LATERAL never
-- errors, and gen_random_uuid() supplies the id (typeIds are stored as bare
-- uuids; the app re-applies the `macro` prefix on read). Author is left null —
-- the old store recorded none.
INSERT INTO "macros" ("id", "name", "body", "scope", "actions", "created_at", "updated_at")
SELECT gen_random_uuid(), cr->>'title', cr->>'body', 'support', '[]'::jsonb, now(), now()
FROM "settings" s
CROSS JOIN LATERAL (
	SELECT pg_temp._m0146_widget_json(s.widget_config) AS cfg
) parsed
CROSS JOIN LATERAL jsonb_array_elements(
	CASE
		WHEN jsonb_typeof(parsed.cfg#>'{messenger,cannedReplies}') = 'array'
			THEN parsed.cfg#>'{messenger,cannedReplies}'
		ELSE '[]'::jsonb
	END
) AS cr
WHERE coalesce(cr->>'title', '') <> '' AND coalesce(cr->>'body', '') <> '';
