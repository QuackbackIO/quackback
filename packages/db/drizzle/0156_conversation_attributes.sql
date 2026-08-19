-- Conversation data attributes (support platform, conversation-data settings).
-- One registry for conversations AND tickets: definitions map machine keys into
-- the custom_attributes jsonb both tables already carry. Values are stored as
-- { v, src, at } envelopes at the app layer; the registry is definition-only.
-- Archive-only lifecycle (archived_at), no hard delete: archived definitions
-- keep their values filterable and their key reserved.
CREATE TABLE "conversation_attribute_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	-- Machine key into custom_attributes (normalized snake_case).
	"key" text NOT NULL,
	"label" text NOT NULL,
	-- Descriptions are first-class: they feed the future AI classifier taxonomy.
	"description" text,
	-- text | number | select | multi_select | checkbox | date (app-enforced,
	-- immutable after creation).
	"field_type" text NOT NULL,
	-- [{id, label, description}] for select/multi_select; option ids are stable
	-- (stored in values), labels renameable.
	"options" jsonb,
	-- Enforced only on teammate inbox close; API/workflow/AI closes bypass.
	"required_to_close" boolean DEFAULT false NOT NULL,
	-- Display-only hint of the expected writer: ai | workflow | agent.
	"source_hint" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_attribute_definitions_key_idx"
	ON "conversation_attribute_definitions" ("key");
--> statement-breakpoint

-- Case-insensitive unique tag names. Existing case-variant duplicates would
-- break the index, so dedupe first: the OLDEST row per lower(name) is the
-- keeper. Give every conversation holding a duplicate the keeper instead
-- (ON CONFLICT collapses a conversation that held several variants to one row).
WITH keepers AS (
	SELECT id,
		first_value(id) OVER (PARTITION BY lower(name) ORDER BY created_at ASC, id ASC) AS keeper_id
	FROM "conversation_tags"
), dupes AS (
	SELECT id, keeper_id FROM keepers WHERE id <> keeper_id
)
INSERT INTO "conversation_tag_assignments" (conversation_id, conversation_tag_id)
SELECT DISTINCT a.conversation_id, d.keeper_id
FROM "conversation_tag_assignments" a
JOIN dupes d ON a.conversation_tag_id = d.id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Detach the duplicates now that the keeper carries their assignments.
WITH keepers AS (
	SELECT id,
		first_value(id) OVER (PARTITION BY lower(name) ORDER BY created_at ASC, id ASC) AS keeper_id
	FROM "conversation_tags"
), dupes AS (
	SELECT id FROM keepers WHERE id <> keeper_id
)
DELETE FROM "conversation_tag_assignments" a
USING dupes d
WHERE a.conversation_tag_id = d.id;
--> statement-breakpoint
-- A soft-deleted keeper absorbing a LIVE duplicate must come back to life, or
-- the live tag would vanish from pickers.
WITH keepers AS (
	SELECT id,
		first_value(id) OVER (PARTITION BY lower(name) ORDER BY created_at ASC, id ASC) AS keeper_id
	FROM "conversation_tags"
), live_dupes AS (
	SELECT k.keeper_id
	FROM keepers k
	JOIN "conversation_tags" t ON t.id = k.id
	WHERE k.id <> k.keeper_id AND t.deleted_at IS NULL
)
UPDATE "conversation_tags" t
SET deleted_at = NULL
FROM live_dupes d
WHERE t.id = d.keeper_id AND t.deleted_at IS NOT NULL;
--> statement-breakpoint
-- Remove the duplicate rows (hard delete: soft-deleted variants would still
-- collide with the new index).
WITH keepers AS (
	SELECT id,
		first_value(id) OVER (PARTITION BY lower(name) ORDER BY created_at ASC, id ASC) AS keeper_id
	FROM "conversation_tags"
), dupes AS (
	SELECT id FROM keepers WHERE id <> keeper_id
)
DELETE FROM "conversation_tags" t
USING dupes d
WHERE t.id = d.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_tags_name_lower_key"
	ON "conversation_tags" (lower("name"));
