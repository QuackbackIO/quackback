-- Convergence Phase 4 (scratchpad/convergence-design.md): user-defined ticket
-- types. A type is a label + icon + color + typed field set WITHIN one of the
-- three fixed categories; the category (tickets.type) stays the behavior axis
-- (cascade rules, portal visibility, SLA exclusion, the one-customer-ticket
-- link rule, ticket_conversations.ticket_type) and becomes derived-at-write
-- from the chosen type, so every existing index and rule is untouched.
--
-- Seed (second-opinion fix): one default type per category carrying the
-- workspace's CUSTOMIZED intake form — the settings.tickets.ts resolveTicketForms
-- merge (settings.metadata->'ticketForms'->category wins when it holds a valid
-- array, else the category default, which is an empty form). Seeding from bare
-- DEFAULT_TICKET_FORMS instead would silently revert customized intake forms.
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" text NOT NULL,
	"icon" text,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"intake_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ticket_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
-- One default per category among live types; the create-dialog preselection
-- and convert_to_ticket's absent-type fallback resolve through this row.
-- Partial so archived defaults and non-defaults never collide.
CREATE UNIQUE INDEX "ticket_types_one_default_per_category_uq" ON "ticket_types" ("category") WHERE is_default = true AND deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ticket_type_id" uuid;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Registry-type filter for the inbox tickets branch (listTickets ticketTypeId).
CREATE INDEX "tickets_ticket_type_id_idx" ON "tickets" ("ticket_type_id");
--> statement-breakpoint
-- Safe reader for the settings.metadata text column: the merge only accepts a
-- parseable JSON object and falls back to '{}' (no customized forms) on NULL,
-- empty, or corrupt content — a hand-edited metadata bag must never abort the
-- migration. Session-scoped; gone when the migration session ends.
CREATE FUNCTION pg_temp._m0215_ticket_forms(metadata text) RETURNS jsonb AS $$
BEGIN
	IF metadata IS NULL OR btrim(metadata) = '' THEN RETURN '{}'::jsonb; END IF;
	RETURN metadata::jsonb -> 'ticketForms';
EXCEPTION WHEN OTHERS THEN RETURN '{}'::jsonb;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Seed one default type per category. The fields carry the workspace's MERGED
-- form: the stored form when metadata holds a jsonb array for the category
-- (stored forms were zod-validated at write time), else the category default
-- '[]' — mirroring resolveTicketForms (settings.tickets.ts). Named after the
-- category: on day one each category has exactly its one legacy form, so the
-- type IS the category's public face. LEFT JOIN so a tenant without a
-- settings row still gets the three default types with empty forms.
INSERT INTO "ticket_types" ("id", "name", "slug", "category", "fields", "is_default", "position", "intake_visible")
SELECT
	gen_random_uuid(),
	v."name",
	v."slug",
	v."category",
	CASE
		WHEN jsonb_typeof(s."forms" -> v."category") = 'array' THEN s."forms" -> v."category"
		ELSE '[]'::jsonb
	END,
	true,
	0,
	true
FROM (VALUES
	('Customer', 'customer', 'customer'),
	('Back-office', 'back_office', 'back_office'),
	('Tracker', 'tracker', 'tracker')
) AS v("name", "slug", "category")
LEFT JOIN (
	SELECT pg_temp._m0215_ticket_forms("metadata") AS "forms"
	FROM "settings"
	ORDER BY "created_at"
	LIMIT 1
) s ON true;
--> statement-breakpoint
-- Backfill: every existing ticket points at its category's seeded default
-- type. Net-zero behavior change — tickets.type (the category) is untouched.
UPDATE "tickets" t
SET "ticket_type_id" = tt."id"
FROM "ticket_types" tt
WHERE tt."category" = t."type"
	AND tt."is_default" = true
	AND tt."deleted_at" IS NULL;
